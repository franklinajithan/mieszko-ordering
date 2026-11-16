import {test,expect} from '@playwright/test';
import postgres from 'postgres';
import * as XLSX from 'xlsx';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});
test.afterAll(async()=>{await sql.end();});
for(const type of ['biff8','html'] as const)test(`worker imports real ${type} RTC bytes saved as .xlsx, retries the failed audit, and does not duplicate quantities`,async({request})=>{
 const [old]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,error_message) VALUES(1,'rtc','manual','failed','2026-10-20','2026-10-20','Report parsing failed: Report columns not detected') RETURNING id`;
 const retry=await(await request.post('/api/download-queue',{headers:{origin:'http://127.0.0.1:3100'},data:{runId:Number(old.id),action:'redownload'}})).json();expect(retry.success).toBe(true);
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-rtc-format-'));const source=path.join(folder,'export.xls');const config=path.join(folder,'config.json');
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
  ['Price Override & RTC Sales History'],['Mieszko Hounslow'],['Date : 20-10-2026'],
  ['Trans Id - Till Name (Code)','EAN','Sale Description','Scanned Date','Qty','Reason'],
  ['623679 - 0365TILL04','5901234560001','Weighted RTC','20/10/2026 12:00','4.675','REDUCE TO CLEAR'],
  ['623573 - 0365TILL04','5901234560001','Weighted RTC','20/10/2026 13:00','0.805','REDUCE TO CLEAR'],
  ['','5901234560001','Ordinary override','20/10/2026 14:00','100','PRICE OVERRIDE'],
 ]),'RTC');writeFileSync(source,XLSX.write(book,{type:'buffer',bookType:type}));
 writeFileSync(config,JSON.stringify({app_directory:process.cwd(),download_directory:path.join(folder,'reports'),stores:{'1':{erp:'msp',feeds:{rtc:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'EAN',quantity:'Qty'},command:['python','-c','import shutil,sys;shutil.copyfile(sys.argv[1],sys.argv[2])',source,'{output}']}}}}}));
 const run=()=>execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 run();
 const audits=await sql`SELECT id,status,imported_row_count,details FROM data_import_runs ORDER BY id`;
 expect(audits[0].status).toBe('failed');expect(audits[1]).toMatchObject({status:'success',imported_row_count:1});expect(audits[1].details.retry_of).toBe(Number(old.id));
 expect(Number((await sql`SELECT rtc_qty FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-20'`)[0].rtc_qty)).toBe(5.48);
 await request.post('/api/download-queue',{headers:{origin:'http://127.0.0.1:3100'},data:{runId:Number(audits[1].id),action:'redownload'}});run();
 expect(Number((await sql`SELECT rtc_qty FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-20'`)[0].rtc_qty)).toBe(5.48);
 const [duplicate]=await sql`SELECT status,imported_row_count,details FROM data_import_runs ORDER BY id DESC LIMIT 1`;
 expect(duplicate.status).toBe('success');expect(duplicate.imported_row_count).toBe(0);expect(duplicate.details.duplicate_of).toBe(Number(audits[1].id));
});
