import {test,expect,type Page} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));await sql.unsafe('TRUNCATE orders RESTART IDENTITY CASCADE').simple();});
test.afterAll(async()=>{await sql.end();});

// Isolate approval to one missing report. Queue creation, status polling,
// fixture download/import and final generation use the real APIs.
function runFixtureReport(){
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-approved-recovery-'));const config=path.join(folder,'config.json');
 writeFileSync(config,JSON.stringify({download_directory:path.join(folder,'downloads'),app_directory:process.cwd(),stores:{'1':{erp:'msp',feeds:{normal_sales:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Sold Qty'},command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
}

async function missingReport(page:Page) {
 await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
 let generationRequests=0;
 await page.route('**/api/order-sheet/generate',async route=>{generationRequests++;await route.continue();});
 await page.route('**/api/order-sheet/preflight',async route=>{
  const response=await route.fetch();const body=await response.json();
  const [saved]=await sql.unsafe("SELECT count(*)::int AS count FROM data_import_runs WHERE store_id=1 AND source_type='normal_sales' AND status='success' AND source_start_date='2026-10-07'").simple();
  body.data.feedCoverage=[{source:'normal_sales',missing:saved.count?[]:[{storeId:1,date:'2026-10-07'}]}];
  await route.fulfill({response,json:body});
 });
 await page.route('**/api/automation/coverage?**',async route=>{
  const [run]=await sql.unsafe("SELECT id,status FROM data_import_runs WHERE store_id=1 AND source_type='normal_sales' AND source_start_date='2026-10-07' ORDER BY id DESC LIMIT 1").simple();
  const rows=run?.status==='success'?[]:[{store_id:1,store_name:'Hounslow',source_type:'normal_sales',day:'2026-10-07',status:run?.status??'missing',reason:'Report is not available for this date.',can_download:!run||run.status==='failed',run_id:run?.id??null,configuration_required:false,has_rows:false}];
  await route.fulfill({json:{success:true,data:{rows,total:rows.length,pages:1,page:1,unavailable:rows.length,pending:0}}});
 });
 await page.goto('/order-sheet');
 await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
 const dialog=page.getByRole('alertdialog');
 await expect(dialog.getByText('Download missing reports?',{exact:true})).toBeVisible();
 await expect(dialog.getByText('Hounslow · 2026-10-07 · normal sales',{exact:true})).toBeVisible();
 return {dialog,generationRequests:()=>generationRequests};
}

test('missing reports require permission and cancellation creates neither downloads nor orders',async({page})=>{
 const state=await missingReport(page);
 expect(state.generationRequests()).toBe(0);
 expect((await sql.unsafe("SELECT id FROM data_import_runs").simple())).toHaveLength(0);
 await state.dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(state.dialog).toBeHidden();
 expect(state.generationRequests()).toBe(0);
 expect((await sql.unsafe("SELECT id FROM data_import_runs").simple())).toHaveLength(0);
 expect((await sql.unsafe("SELECT id FROM orders").simple())).toHaveLength(0);
});

test('approved reports notify completion and wait for permission to proceed',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:{origin:'http://127.0.0.1:3100'},data:{crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false}});
 const state=await missingReport(page);
 await state.dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toHaveAttribute('aria-valuenow','0');
 const [queued]=await sql.unsafe("SELECT id,status,source_start_date::text AS day FROM data_import_runs").simple();
 expect(queued).toMatchObject({status:'queued',day:'2026-10-07'});expect(state.generationRequests()).toBe(0);
 runFixtureReport();
 const completed=page.getByRole('alertdialog');
 await expect(completed.getByText('Reports downloaded and imported',{exact:true})).toBeVisible({timeout:25000});
 expect(state.generationRequests()).toBe(0);
 expect((await sql.unsafe("SELECT id FROM orders").simple())).toHaveLength(0);
 await completed.getByRole('button',{name:'Review first',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toHaveAttribute('aria-valuenow','100');
 await page.getByRole('button',{name:'Proceed with order',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'})).toBeVisible({timeout:45000});
 expect(state.generationRequests()).toBe(1);
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:'Dairy workbook',exact:true}).click();
 expect((await downloadEvent).suggestedFilename()).toContain('Dairy Order');
 expect((await sql.unsafe("SELECT status FROM data_import_runs WHERE id="+Number(queued.id)).simple())[0].status).toBe('success');
});

test('failed recovery stays visible and never generates an order automatically',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:{origin:'http://127.0.0.1:3100'},data:{crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false}});
 const state=await missingReport(page);
 await state.dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toBeVisible();
 await sql.unsafe("UPDATE data_import_runs SET status='failed',error_message='CRM report is not available for this date' WHERE store_id=1").simple();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toHaveAttribute('aria-valuenow','100',{timeout:25000});
 await expect(page.getByText('CRM report is not available for this date',{exact:false})).toBeVisible();
 expect(state.generationRequests()).toBe(0);
 expect((await sql.unsafe("SELECT id FROM orders").simple())).toHaveLength(0);
});

test('missing book stock offers an approved worker refresh without creating an order',async({page})=>{
 await sql.unsafe("DELETE FROM book_stock WHERE store_product_id IN(11,12,13)").simple();
 await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
 await page.goto('/order-sheet');
 await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
 const dialog=page.getByRole('alertdialog');
 await expect(dialog.getByText('Hounslow · Latest snapshot · book stock',{exact:true})).toBeVisible();
 expect((await sql.unsafe("SELECT id FROM data_import_runs").simple())).toHaveLength(0);
 await dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toBeVisible();
 expect((await sql.unsafe("SELECT source_type,status FROM data_import_runs").simple())).toEqual([{source_type:'book_stock',status:'queued'}]);
 expect((await sql.unsafe("SELECT id FROM orders").simple())).toHaveLength(0);
});

test('Generate discovers last-year comparison reports on the order screen and skips existing sales',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:{origin:'http://127.0.0.1:3100'},data:{crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false}});
 await sql.unsafe("INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) SELECT id,'2025-10-07',0 FROM store_products WHERE store_id<>1").simple();
 await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
 await page.goto('/order-sheet');
 await page.getByRole('checkbox',{name:'Include RTC',exact:true}).uncheck();
 await page.getByRole('checkbox',{name:'Include Wastage',exact:true}).uncheck();
 await page.locator('input[name="period-comparison-period-1-start"]').fill('2025-10-07',{force:true});
 await page.locator('input[name="period-comparison-period-1-end"]').fill('2025-10-07',{force:true});
 await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
 const dialog=page.getByRole('alertdialog');
 await expect(dialog.getByText('Hounslow · 2025-10-07 · normal sales',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true})).toBeVisible();
 expect((await sql.unsafe("SELECT id FROM data_import_runs").simple())).toHaveLength(0);
 await dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toBeVisible();
 expect((await sql.unsafe("SELECT store_id,source_type,source_start_date::text AS day FROM data_import_runs").simple())).toEqual([{store_id:1,source_type:'normal_sales',day:'2025-10-07'}]);
 runFixtureReport();
 const completed=page.getByRole('alertdialog');
 await expect(completed.getByText('Reports downloaded and imported',{exact:true})).toBeVisible({timeout:25000});
 expect((await sql.unsafe("SELECT id FROM orders").simple())).toHaveLength(0);
 await completed.getByRole('button',{name:'Proceed with order',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'})).toBeVisible({timeout:45000});
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:'Dairy workbook',exact:true}).click();
 expect((await downloadEvent).suggestedFilename()).toContain('Dairy Order');
 expect((await sql.unsafe("SELECT status FROM data_import_runs WHERE source_start_date='2025-10-07'").simple())[0].status).toBe('success');

});

test('day-by-day dates outside comparison periods detect only missing Normal Sales',async({request})=>{
 const input={storeIds:[1],supplierIds:[1],includeBookStock:false,includeRtc:true,includeWastage:true,comparisonPeriods:[{startDate:'2026-10-01',endDate:'2026-10-07'}],dayBySalesRequired:true,dayBySalesStartDate:'2025-10-07',dayBySalesEndDate:'2025-10-08'};
 const response=await request.post('/api/order-sheet/preflight',{data:input});
 expect(response.ok()).toBe(true);
 const feeds=(await response.json()).data.feedCoverage;
 expect(feeds.find((feed:{source:string})=>feed.source==='normal_sales').missing).toEqual([{storeId:1,date:'2025-10-07'},{storeId:1,date:'2025-10-08'}]);
 for(const source of ['rtc','wastage'])expect(feeds.find((feed:{source:string})=>feed.source===source).missing).toEqual([]);
 const disabled=await request.post('/api/order-sheet/preflight',{data:{...input,dayBySalesRequired:false}});
 expect((await disabled.json()).data.feedCoverage.every((feed:{missing:unknown[]})=>feed.missing.length===0)).toBe(true);
});

test('one approval queues more than 250 reports and checks every job in bounded status requests',async({page,request})=>{
 test.setTimeout(90000);
 await request.put('/api/automation/stores/1',{headers:{origin:'http://127.0.0.1:3100'},data:{crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false}});
 const dates=Array.from({length:251},(_,index)=>new Date(Date.UTC(2025,0,1+index)).toISOString().slice(0,10));
 const checked=new Set<number>();const sizes:number[]=[];
 await page.route('**/api/order-sheet/recovery-status?**',async route=>{
  const ids=new URL(route.request().url()).searchParams.get('ids')!.split(',').map(Number);
  sizes.push(ids.length);ids.forEach(id=>checked.add(id));await route.continue();
 });
 await page.route('**/api/order-sheet/preflight',async route=>{
  const response=await route.fetch();const body=await response.json();
  body.data.feedCoverage=[{source:'normal_sales',missing:dates.map(date=>({storeId:1,date}))}];
  await route.fulfill({response,json:body});
 });
 await page.route('**/api/automation/coverage?**',async route=>{
  const rows=dates.map(day=>({store_id:1,store_name:'Hounslow',source_type:'normal_sales',day,status:'missing',reason:'Historical report is missing',can_download:true,run_id:null,configuration_required:false}));
  await route.fulfill({json:{success:true,data:{rows,total:251,pages:1,page:1,unavailable:251,pending:0}}});
 });
 await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
 await page.goto('/order-sheet');await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
 await page.getByRole('alertdialog').getByRole('button',{name:'Approve download of 251 reports',exact:true}).click();
 await expect(page.getByText('0 of 251 jobs finished (0%)',{exact:true})).toBeVisible({timeout:45000});
 const queued=await sql.unsafe("SELECT id FROM data_import_runs ORDER BY source_start_date").simple();
 expect(queued).toHaveLength(251);
 expect([...checked].sort((a,b)=>a-b)).toEqual(queued.map(row=>Number(row.id)).sort((a,b)=>a-b));
 expect(sizes.length).toBeGreaterThanOrEqual(2);expect(sizes.every(size=>size<=250)).toBe(true);
 expect((await sql.unsafe("SELECT id FROM orders").simple())).toHaveLength(0);
});

test('saved matching rows with unmatched products complete recovery without a failure',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:{origin:'http://127.0.0.1:3100'},data:{crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false}});
 const state=await missingReport(page);
 await state.dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toBeVisible();
 await sql.unsafe("UPDATE data_import_runs SET status='success',imported_row_count=849,details=details||'{\"partial_import\":true,\"has_unmatched_products\":true,\"unknown_product_codes\":[\"REVIEW-ME\"]}'::jsonb WHERE store_id=1").simple();
 const completion=page.getByRole('alertdialog');
 await expect(completion.getByText('Reports downloaded and imported',{exact:true})).toBeVisible({timeout:25000});
 expect(state.generationRequests()).toBe(0);
 await completion.getByRole('button',{name:'Review first',exact:true}).click();
 await expect(page.getByText('0 in progress · 1 completed · 1 with unmatched products · 0 failed or stopped',{exact:true})).toBeVisible();
 await expect(page.getByText('Imported · unmatched products',{exact:true})).toBeVisible();
});
