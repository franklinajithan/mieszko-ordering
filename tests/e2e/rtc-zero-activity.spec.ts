import {test,expect} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});
test.afterAll(async()=>{await sql.end();});
for(const wrongDate of [false,true])test(`empty RTC ${wrongDate?'rejects another report date':'succeeds and records zero activity'}`,async({request})=>{
 const [run]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date) VALUES(1,'rtc','manual','queued','2026-10-15','2026-10-15') RETURNING id`;
 await sql`INSERT INTO rtc_sales(store_product_id,rtc_date,rtc_qty) VALUES(11,'2026-10-15',5)`;
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-zero-'));const config=path.join(folder,'config.json');
 const script="import sys;from openpyxl import Workbook;w=Workbook();s=w.active;s.append(['RTC']);s.append(['Date Range: "+(wrongDate?'14':'15')+"-10-2026 to "+(wrongDate?'14':'15')+"-10-2026']);s.append(['No Records Available']);w.save(sys.argv[1])";
 writeFileSync(config,JSON.stringify({app_directory:process.cwd(),download_directory:path.join(folder,'reports'),stores:{'1':{erp:'msp',feeds:{rtc:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Qty'},command:['python','-c',script,'{output}']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 const [audit]=await sql`SELECT status,imported_row_count,details,error_message FROM data_import_runs WHERE id=${run.id}`;
 if(wrongDate){
  expect(audit.status).toBe('failed');expect(audit.error_message).toContain('date differs');
  expect(Number((await sql`SELECT rtc_qty FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-15'`)[0].rtc_qty)).toBe(5);
 }else{
  expect(audit.status).toBe('success');expect(audit.imported_row_count).toBe(0);expect(audit.details.zero_activity).toBe(true);
  expect(await sql`SELECT * FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-15'`).toHaveLength(0);
  const result=await (await request.post('/api/order-sheet/preflight',{data:{storeIds:[1],supplierIds:[1],includeBookStock:false,includeRtc:true,comparisonPeriods:[{startDate:'2026-10-15',endDate:'2026-10-15'}]}})).json();
  expect(result.data.feedCoverage.find((feed:{source:string})=>feed.source==='rtc').missing).toEqual([]);
 }
});

test('manual zero RTC validates bytes, records coverage, replaces old quantities and exports zero',async({request,page})=>{
 const XLSX=await import('xlsx');
 const ExcelJS=(await import('exceljs')).default;
 function bytes(rows:unknown[][],xls=false){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'RTC');return XLSX.write(book,{type:'buffer',bookType:xls?'biff8':'xlsx'}) as Buffer;}
 async function upload(buffer:Buffer,name='rtc.xlsx'){return request.post('/api/imports/rtc',{multipart:{storeId:'1',rtcDate:'2026-10-07',file:{name,mimeType:'application/octet-stream',buffer}}});}
 for(const rows of [ [['Hayes RTC'],['No Records Available']], [['RTC'],['Date: 06-10-2026'],['No Records Available']] ]){
  const bad=await upload(bytes(rows));expect(bad.ok()).toBe(false);
  expect(Number((await sql`SELECT rtc_qty FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-07'`)[0].rtc_qty)).toBe(1);
 }
 expect((await upload(Buffer.from('corrupt workbook'))).ok()).toBe(false);
 for(const xls of [true,false]){
  const response=await upload(bytes([['Hounslow RTC'],['Date Range: 07-10-2026 to 07-10-2026'],['No Records Available']],xls),xls?'rtc.xls':'rtc.xlsx');
  expect(response.ok(),await response.text()).toBe(true);
 }
 const header=await upload(bytes([['Hounslow RTC'],['Date: 07-10-2026'],['Item Code','Qty']]));expect(header.ok(),await header.text()).toBe(true);
 expect(await sql`SELECT * FROM rtc_sales WHERE rtc_date='2026-10-07' AND store_product_id IN(SELECT id FROM store_products WHERE store_id=1)`).toHaveLength(0);
 const audits=await sql`SELECT id,status,imported_row_count,details FROM data_import_runs WHERE store_id=1 AND source_type='rtc'`;
 expect(audits).toHaveLength(3);for(const row of audits){expect(row.status).toBe('success');expect(row.imported_row_count).toBe(0);expect(row.details.zero_activity).toBe(true);}
 const monitoring=await(await request.get('/api/data-operations/status')).json();expect(monitoring.success,JSON.stringify(monitoring)).toBe(true);expect(monitoring.rows.find((row:{store_id:number;source_type:string})=>row.store_id===1&&row.source_type==='rtc')).toMatchObject({zero_activity:true,latest_data_date:'2026-10-07',last_successful_row_count:0});
 const counts=(await(await request.get('/api/download-queue?view=completed&storeId=1&feed=rtc')).json()).data.counts;expect(counts.success).toBe(3);expect(counts.failed??0).toBe(0);
 const progress=(await(await request.get('/api/order-sheet/recovery-status?ids='+audits.map(row=>row.id).join(','))).json()).data.jobs;expect(progress.every((job:{status:string;zero_activity:boolean})=>job.status==='success'&&job.zero_activity)).toBe(true);
 const input={storeIds:[1],supplierIds:[1,2,3],departmentIds:[1],orderDate:'2026-10-08',deliveryDate:'2026-10-10',includeBookStock:true,includeRtc:true,soldQtyMethod:'average',shortfallPeriods:[{startDate:'2026-10-10',endDate:'2026-10-12'}],comparisonPeriods:[{startDate:'2026-10-07',endDate:'2026-10-07'}]};
 const preflight=await(await request.post('/api/order-sheet/preflight',{data:input})).json();expect(preflight.data.feedCoverage.find((feed:{source:string})=>feed.source==='rtc').missing).toEqual([]);
 const generated=await(await request.post('/api/order-sheet/generate',{data:input})).json();expect(generated.success,JSON.stringify(generated)).toBe(true);
 const exported=await(await request.post(`/api/orders/${generated.data.orderId}/export-dairy`,{headers:{origin:'http://127.0.0.1:3100'}})).json();expect(exported.success,JSON.stringify(exported)).toBe(true);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(exported.data.base64,'base64') as unknown as import('exceljs').Buffer);
 const sheet=workbook.getWorksheet('Product')!;const columns=sheet.getRow(1).values as import('exceljs').CellValue[];
 const row=sheet.getRows(2,sheet.rowCount-1)!.find(row=>row.getCell(1).value==='10001')!;expect(row.getCell(columns.indexOf('RTC')).value).toBe(0);
 await page.goto('/downloads');await page.getByRole('button',{name:/Completed/}).click();await expect(page.getByText('Zero RTC activity · Report date available').first()).toBeVisible();
});

for(const barcode of [false,true])test(`manual mixed RTC (${barcode?'barcode':'item code'}) retains rows for replay without downloading`,async({request})=>{
 const XLSX=await import('xlsx');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[barcode?'EAN':'Item Code','Qty'],[barcode?'5901234560001':'10001',4],[barcode?'00001234':'ŻÓŁĆ-RTC',3]]),'RTC');
 const response=await request.post('/api/imports/rtc',{multipart:{storeId:'1',rtcDate:'2026-10-15',file:{name:'rtc.xlsx',mimeType:'application/octet-stream',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})}}});
 let imported=await response.json();expect(imported.success,JSON.stringify(imported)).toBe(true);expect(imported.data).toMatchObject({matchedRows:1,unmatchedRows:1,message:'Imported — unmatched products awaiting review'});
 const repeated=await request.post('/api/imports/rtc',{multipart:{storeId:'1',rtcDate:'2026-10-15',file:{name:'rtc.xlsx',mimeType:'application/octet-stream',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})}}});
 imported=await repeated.json();expect(imported.success,JSON.stringify(imported)).toBe(true);
 expect(Number((await sql`SELECT rtc_qty FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-15'`)[0].rtc_qty)).toBe(4);
 const runId=imported.data.runId;expect(await sql`SELECT * FROM crm_report_stage WHERE run_id=${runId}`).toHaveLength(2);
 if(barcode)await sql`INSERT INTO product_barcodes(store_id,barcode,store_product_id) VALUES(1,'00001234',12)`;
 else await sql`INSERT INTO crm_product_code_aliases(store_id,identifier,store_product_id) VALUES(1,'ŻÓŁĆ-RTC',12)`;
 await request.post('/api/unmatched-products');const [retry]=await sql`SELECT id FROM data_import_runs WHERE details->>'retry_of'=${String(runId)}`;expect(retry).toBeTruthy();
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-replay-'));const config=path.join(folder,'config.json');
 writeFileSync(config,JSON.stringify({app_directory:process.cwd(),download_directory:path.join(folder,'reports'),stores:{'1':{erp:'msp',feeds:{rtc:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Qty'},command:['python','-c','raise Exception("must reuse stage")']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 const [audit]=await sql`SELECT status,details FROM data_import_runs WHERE id=${retry.id}`;expect(audit.status).toBe('success');expect(audit.details.reused_stage_of).toBe(runId);
 for(let i=0;i<2;i++)await request.post('/api/unmatched-products');
 expect((await sql`SELECT rtc_qty::text AS qty FROM rtc_sales WHERE rtc_date='2026-10-15' ORDER BY store_product_id`).map(row=>row.qty)).toEqual(['4.0000','3.0000']);
 expect(await sql`SELECT * FROM data_import_runs WHERE status='queued'`).toHaveLength(0);
});

test('manual zero RTC upload works from preview through the saved-date screen',async({page})=>{
 const XLSX=await import('xlsx');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Hounslow RTC'],['Date: 15-10-2026'],['No Records Available']]),'RTC');
 await page.goto('/rtc');await page.locator('select[name="storeId"]').selectOption('1');
 await page.locator('input[type="file"]').setInputFiles({name:'rtc.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
 await page.getByRole('button',{name:'Preview file',exact:true}).click();
 await page.getByRole('button',{name:'Import RTC',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Zero RTC activity'})).toBeVisible();
 await expect(page.getByRole('cell',{name:'2026-10-15',exact:true})).toBeVisible();
 expect((await sql`SELECT status,imported_row_count FROM data_import_runs WHERE source_type='rtc'`)[0]).toMatchObject({status:'success',imported_row_count:0});
});

for(const variant of ['header-only','wrong-store','unreadable'])test(`worker ${variant} RTC validates before replacing saved data`,async()=>{
 await sql`INSERT INTO rtc_sales(store_product_id,rtc_date,rtc_qty) VALUES(11,'2026-10-15',5)`;
 const [run]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date) VALUES(1,'rtc','manual','queued','2026-10-15','2026-10-15') RETURNING id`;
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-validate-'));const config=path.join(folder,'config.json');
 const script=variant==='unreadable'?"import sys;open(sys.argv[1],'w').write('corrupt file')":"import sys;from openpyxl import Workbook;w=Workbook();s=w.active;s.append(['"+(variant==='wrong-store'?'Hayes':'Hounslow')+" RTC']);s.append(['Date: 15-10-2026']);s.append("+(variant==='header-only'?"['Item Code','Qty']":"['No Records Available']")+");w.save(sys.argv[1])";
 writeFileSync(config,JSON.stringify({app_directory:process.cwd(),download_directory:path.join(folder,'reports'),stores:{'1':{erp:'msp',feeds:{rtc:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Qty'},command:['python','-c',script,'{output}']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 const [audit]=await sql`SELECT status,details,error_message FROM data_import_runs WHERE id=${run.id}`;
 expect(audit.status).toBe(variant==='header-only'?'success':'failed');
 const rows=await sql`SELECT rtc_qty FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-15'`;
 if(variant==='header-only'){expect(rows).toHaveLength(0);expect(audit.details.zero_activity).toBe(true);}else{expect(Number(rows[0].rtc_qty)).toBe(5);if(variant==='wrong-store')expect(audit.error_message).toContain('another store');}
});

test('manual report with no current matches is retained for review instead of treated as zero activity',async({page})=>{
 const XLSX=await import('xlsx');const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Price Override & RTC Sales History'],['Date: 15-10-2026'],['EAN','Sale Description','Qty'],['00001234','Unmapped milk',2]]),'RTCReport');
 await page.goto('/rtc');await page.locator('select[name="storeId"]').selectOption('1');
 await page.locator('input[type="file"]').setInputFiles({name:'RTCReport.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
 await page.getByRole('button',{name:'Preview file',exact:true}).click();
 await expect(page.getByRole('button',{name:'Import RTC',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Import RTC',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Imported — unmatched products awaiting review'})).toBeVisible();
 const [run]=await sql`SELECT id,status,details FROM data_import_runs WHERE source_type='rtc'`;
 expect(run.status).toBe('success');expect(run.details.zero_activity).toBe(false);expect(run.details.has_unmatched_products).toBe(true);
 expect(await sql`SELECT * FROM crm_report_stage WHERE run_id=${run.id}`).toHaveLength(1);
});

test('historical empty RTC failure retries through corrected validation while preserving the failed audit',async({request})=>{
 const [old]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,error_message,completed_at) VALUES(1,'rtc','nightly','failed','2026-10-15','2026-10-15','Report parsing failed: Report columns not detected Previous data retained.',now()-interval '2 hours') RETURNING id`;
 const retried=await(await request.post('/api/download-queue',{headers:{origin:'http://127.0.0.1:3100'},data:{runId:Number(old.id),action:'redownload'}})).json();expect(retried.success,JSON.stringify(retried)).toBe(true);
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-historical-'));const config=path.join(folder,'config.json');
 const script="import sys;from openpyxl import Workbook;w=Workbook();s=w.active;s.append(['Hounslow RTC']);s.append(['Date: 15-10-2026']);s.append(['No Records Available']);w.save(sys.argv[1])";
 writeFileSync(config,JSON.stringify({app_directory:process.cwd(),download_directory:path.join(folder,'reports'),stores:{'1':{erp:'msp',feeds:{rtc:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Qty'},command:['python','-c',script,'{output}']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 const audits=await sql`SELECT id,status,imported_row_count,details FROM data_import_runs ORDER BY id`;
 expect(audits).toHaveLength(2);expect(audits[0].status).toBe('failed');expect(audits[1]).toMatchObject({status:'success',imported_row_count:0});expect(audits[1].details).toMatchObject({zero_activity:true,retry_of:Number(old.id)});
 // The regular preflight consumes audit coverage even with no transaction rows.
 const preflight=await(await request.post('/api/order-sheet/preflight',{data:{storeIds:[1],supplierIds:[1],includeBookStock:false,includeRtc:true,comparisonPeriods:[{startDate:'2026-10-15',endDate:'2026-10-15'}]}})).json();
 expect(preflight.data.feedCoverage.find((feed:{source:string})=>feed.source==='rtc').missing).toEqual([]);
});
