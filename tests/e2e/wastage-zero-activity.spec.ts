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
for(const wrongDate of [false,true])test(`empty Wastage ${wrongDate?'rejects another report date':'succeeds and records zero activity'}`,async({request})=>{
 const [run]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date) VALUES(1,'wastage','manual','queued','2026-10-15','2026-10-15') RETURNING id`;
 await sql`INSERT INTO wastage(store_product_id,wastage_date,wastage_qty) VALUES(11,'2026-10-15',5)`;
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-zero-'));const config=path.join(folder,'config.json');
 const script="import sys;from openpyxl import Workbook;w=Workbook();s=w.active;s.append(['Wastage']);s.append(['Date Range: "+(wrongDate?'14':'15')+"-10-2026 to "+(wrongDate?'14':'15')+"-10-2026']);s.append(['No Records Available']);w.save(sys.argv[1])";
 writeFileSync(config,JSON.stringify({app_directory:process.cwd(),download_directory:path.join(folder,'reports'),stores:{'1':{erp:'msp',feeds:{wastage:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Qty'},command:['python','-c',script,'{output}']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 const [audit]=await sql`SELECT status,imported_row_count,details,error_message FROM data_import_runs WHERE id=${run.id}`;
 if(wrongDate){
  expect(audit.status).toBe('failed');expect(audit.error_message).toContain('date differs');
  expect(Number((await sql`SELECT wastage_qty FROM wastage WHERE store_product_id=11 AND wastage_date='2026-10-15'`)[0].wastage_qty)).toBe(5);
 }else{
  expect(audit.status).toBe('success');expect(audit.imported_row_count).toBe(0);expect(audit.details.zero_activity).toBe(true);
  expect(await sql`SELECT * FROM wastage WHERE store_product_id=11 AND wastage_date='2026-10-15'`).toHaveLength(0);
  const result=await (await request.post('/api/order-sheet/preflight',{data:{storeIds:[1],supplierIds:[1],includeBookStock:false,includeWastage:true,comparisonPeriods:[{startDate:'2026-10-15',endDate:'2026-10-15'}]}})).json();
  expect(result.data.feedCoverage.find((feed:{source:string})=>feed.source==='wastage').missing).toEqual([]);
 }
});
