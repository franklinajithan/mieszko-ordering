import {test,expect,type Page} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});
test.afterAll(async()=>{await sql.end();});

// Isolate approval to one missing report. Queue creation, status polling,
// fixture download/import and final generation use the real APIs.
async function missingReport(page:Page) {
 await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
 let generationRequests=0;
 await page.route('**/api/order-sheet/generate',async route=>{generationRequests++;await route.continue();});
 await page.route('**/api/order-sheet/preflight',async route=>{
  const response=await route.fetch();const body=await response.json();
  const [saved]=await sql`SELECT count(*)::int AS count FROM data_import_runs WHERE store_id=1 AND source_type='normal_sales' AND status='success' AND source_start_date='2026-10-07'`;
  body.data.feedCoverage=[{source:'normal_sales',missing:saved.count?[]:[{storeId:1,date:'2026-10-07'}]}];
  await route.fulfill({response,json:body});
 });
 await page.route('**/api/automation/coverage?**',async route=>{
  const [run]=await sql`SELECT id,status FROM data_import_runs WHERE store_id=1 AND source_type='normal_sales' AND source_start_date='2026-10-07' ORDER BY id DESC LIMIT 1`;
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
 expect((await sql`SELECT id FROM data_import_runs`)).toHaveLength(0);
 await state.dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(state.dialog).toBeHidden();
 expect(state.generationRequests()).toBe(0);
 expect((await sql`SELECT id FROM data_import_runs`)).toHaveLength(0);
 expect((await sql`SELECT id FROM orders`)).toHaveLength(0);
});

test('approved report downloads show progress and successful imports automatically regenerate',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:{origin:'http://127.0.0.1:3100'},data:{crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false}});
 const state=await missingReport(page);
 await state.dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toHaveAttribute('aria-valuenow','0');
 const [queued]=await sql`SELECT id,status,source_start_date::text AS day FROM data_import_runs`;
 expect(queued).toMatchObject({status:'queued',day:'2026-10-07'});expect(state.generationRequests()).toBe(0);
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-approved-recovery-'));const config=path.join(folder,'config.json');
 writeFileSync(config,JSON.stringify({download_directory:path.join(folder,'downloads'),app_directory:process.cwd(),stores:{'1':{erp:'msp',feeds:{normal_sales:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Sold Qty'},command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toHaveAttribute('aria-valuenow','100',{timeout:25000});
 await expect(page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'})).toBeVisible({timeout:45000});
 expect(state.generationRequests()).toBe(1);
 expect((await sql`SELECT status FROM data_import_runs WHERE id=${queued.id}`)[0].status).toBe('success');
});

test('failed recovery stays visible and never generates an order automatically',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:{origin:'http://127.0.0.1:3100'},data:{crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false}});
 const state=await missingReport(page);
 await state.dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toBeVisible();
 await sql`UPDATE data_import_runs SET status='failed',error_message='CRM report is not available for this date' WHERE store_id=1`;
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toHaveAttribute('aria-valuenow','100',{timeout:25000});
 await expect(page.getByText('CRM report is not available for this date',{exact:false})).toBeVisible();
 expect(state.generationRequests()).toBe(0);
 expect((await sql`SELECT id FROM orders`)).toHaveLength(0);
});

test('missing book stock offers an approved worker refresh without creating an order',async({page})=>{
 await sql`DELETE FROM book_stock WHERE store_product_id IN(11,12,13)`;
 await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
 await page.goto('/order-sheet');
 await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
 const dialog=page.getByRole('alertdialog');
 await expect(dialog.getByText('Hounslow · Latest snapshot · book stock',{exact:true})).toBeVisible();
 expect((await sql`SELECT id FROM data_import_runs`)).toHaveLength(0);
 await dialog.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toBeVisible();
 expect((await sql`SELECT source_type,status FROM data_import_runs`)).toEqual([{source_type:'book_stock',status:'queued'}]);
 expect((await sql`SELECT id FROM orders`)).toHaveLength(0);
});
