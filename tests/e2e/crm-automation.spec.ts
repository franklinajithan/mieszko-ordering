import {test,expect} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';

const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});
test.afterAll(async()=>{await sql.end();});
const origin={origin:'http://127.0.0.1:3100'};
const settings={crmUrl:'http://127.0.0.1:3201/',nightlyEnabled:false};

test('CRM UI saves changed store URLs and splits a range into three independent daily feeds',async({page,request})=>{
 await page.goto('/automation');
 await page.getByRole('textbox',{name:'Hounslow CRM URL'}).fill(settings.crmUrl);
 await page.getByRole('button',{name:'Save Hounslow CRM settings'}).click();
 await expect(page.getByRole('status')).toContainText('CRM settings saved');
 await page.reload();await expect(page.getByRole('textbox',{name:'Hounslow CRM URL'})).toHaveValue(settings.crmUrl);
 await page.getByRole('textbox',{name:'Hounslow CRM URL'}).fill('http://127.0.0.1:3201/changed');
 await page.getByRole('button',{name:'Save Hounslow CRM settings'}).click();
 await expect(page.getByRole('status')).toContainText('CRM settings saved');
 expect((await sql`SELECT crm_url FROM store_crm_settings WHERE store_id=1`)[0].crm_url).toBe('http://127.0.0.1:3201/changed');
 await page.getByRole('checkbox',{name:'Hounslow',exact:true}).check();
 await page.getByLabel('From date',{exact:true}).fill('2026-10-01');
 await page.getByLabel('To date',{exact:true}).fill('2026-10-03');
 await page.getByRole('button',{name:'Queue daily downloads'}).click();
 await expect(page.getByRole('status')).toContainText('9 daily report jobs queued');
 const rows=await sql`SELECT store_id,source_type,source_start_date::text AS day,source_end_date::text AS last FROM data_import_runs`;
 expect(rows).toHaveLength(9);expect(new Set(rows.map(r=>r.source_type))).toEqual(new Set(['normal_sales','rtc','wastage']));
 expect(rows.every(r=>r.store_id===1&&r.day===r.last)).toBe(true);
 const again=await request.post('/api/automation/imports',{headers:origin,data:{storeIds:[1],feeds:['normal_sales','rtc','wastage'],startDate:'2026-10-01',endDate:'2026-10-03'}});
 expect(again.status(),await again.text()).toBe(202);expect((await again.json()).data.queued).toBe(0);
});

test('CRM API rejects invalid addresses, Book Stock, invalid dates, disabled stores and cross-origin requests',async({request})=>{
 for(const crmUrl of ['file:///tmp/data','http://user:secret@crm.test/','http://crm.test/?pin=secret']){
  expect((await request.put('/api/automation/stores/1',{headers:origin,data:{...settings,crmUrl}})).status()).toBe(400);
 }
 expect((await request.put('/api/automation/stores/1',{headers:{origin:'https://foreign.example'},data:settings})).status()).toBe(403);
 expect((await request.put('/api/automation/stores/999',{headers:origin,data:settings})).status()).toBe(400);
 await request.put('/api/automation/stores/1',{headers:origin,data:settings});
 const input={storeIds:[1],feeds:['normal_sales'],startDate:'2026-10-01',endDate:'2026-10-01'};
 for(const patch of [{feeds:['book_stock']},{startDate:'2026-02-30'},{endDate:'2099-01-01'},{startDate:'2026-09-01',endDate:'2026-10-03'},{storeIds:[999]}]){
  expect((await request.post('/api/automation/imports',{headers:origin,data:{...input,...patch}})).status()).toBe(400);
 }
 await sql`UPDATE stores SET is_active=false WHERE id=1`;
 expect((await request.post('/api/automation/imports',{headers:origin,data:input})).status()).toBe(400);
 expect((await request.put('/api/automation/stores/1',{headers:origin,data:{...settings,nightlyEnabled:true}})).status()).toBe(400);
});

test('queue transaction avoids partial requests and only explicitly re-downloads completed dates',async({request})=>{
 await request.put('/api/automation/stores/1',{headers:origin,data:settings});
 const input={storeIds:[1],feeds:['rtc'],startDate:'2026-10-01',endDate:'2026-10-01'};
 const invalid=await request.post('/api/automation/imports',{headers:origin,data:{...input,storeIds:[1,2]}});
 expect(invalid.status()).toBe(400);expect((await sql`SELECT count(*)::int AS n FROM data_import_runs`)[0].n).toBe(0);
 await request.post('/api/automation/imports',{headers:origin,data:input});
 await sql`UPDATE data_import_runs SET status='success'`;
 expect((await (await request.post('/api/automation/imports',{headers:origin,data:input})).json()).data.queued).toBe(0);
 expect((await (await request.post('/api/automation/imports',{headers:origin,data:{...input,replaceCompleted:true}})).json()).data.queued).toBe(1);
 expect((await (await request.post('/api/automation/imports',{headers:origin,data:{...input,replaceCompleted:true}})).json()).data.queued).toBe(0);
});

test('offline Nebula: changed DB URL, daily exports, worker parser and independent PostgreSQL feeds',async({request})=>{
 test.setTimeout(120000);
 const server=spawn(process.execPath,['tests/support/fixture-nebula-server.mjs'],{stdio:['ignore','pipe','inherit']});
 try{
  await new Promise<void>((resolve,reject)=>{server.stdout.on('data',data=>{if(String(data).includes('READY'))resolve();});server.once('error',reject);});
  await request.put('/api/automation/stores/1',{headers:origin,data:{...settings,crmUrl:'http://127.0.0.1:3201/wrong-store'}});
  const folder=mkdtempSync(path.join(tmpdir(),'mieszko-nebula-'));const python='python3';
  const command=[python,path.resolve('automation/nebula_download.py'),'--url','{crm_url}','--store-code','{store_code}','--source','{source}','--start','{start}','--end','{end}','--output','{output}'];
  const feeds=Object.fromEntries(['normal_sales','rtc','wastage'].map(source=>[source,{command,extension:'.xls',mapping:{code:'Item Code',quantity:'Qty'},complete_store_report:true,normalize_with_app_parsers:true,timeout_seconds:40}]));
  const config=path.join(folder,'config.json');writeFileSync(config,JSON.stringify({store_settings_source:'database',store_defaults:{feeds},download_directory:folder,app_directory:process.cwd(),node_executable:process.execPath}));
  const env={...process.env,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55432/postgres',MIESZKO_CRM_LOGIN_CODE:'fixture-only'};
  const worker=()=>execFileSync(python,['tests/support/simple-query-worker.py','--config',config,'--once'],{env,timeout:95000}).toString();
  await request.post('/api/automation/imports',{headers:origin,data:{storeIds:[1],feeds:['normal_sales'],startDate:'2026-10-01',endDate:'2026-10-01'}});
  expect(worker()).toContain('failed');expect((await sql`SELECT status FROM data_import_runs`)[0].status).toBe('failed');
  // URL is changed through the API, without restarting/rebuilding/reconfiguring the worker.
  await request.put('/api/automation/stores/1',{headers:origin,data:settings});
  await request.post('/api/automation/imports',{headers:origin,data:{storeIds:[1],feeds:['normal_sales','rtc','wastage'],startDate:'2026-10-01',endDate:'2026-10-02',replaceCompleted:true}});
  const log=worker();expect(log,log).not.toContain('failed');
  expect((await sql`SELECT count(*)::int AS n FROM data_import_runs WHERE status='success'`)[0].n).toBe(6);
  for(const [table,column,qty] of [['daily_sales','sold_qty','4.0000'],['rtc_sales','rtc_qty','1.0000'],['wastage','wastage_qty','0.5000']]){
   const rows=await sql.unsafe(`SELECT ${column}::text AS qty FROM ${table} WHERE store_product_id=11 ORDER BY 1`);expect(rows.some(row=>row.qty===qty)).toBe(true);
  }
  expect((await (await fetch('http://127.0.0.1:3201/observed')).json()).length).toBe(6);
  await sql`UPDATE store_crm_settings SET nightly_enabled=true WHERE store_id=1`;
  execFileSync(python,['tests/support/simple-query-worker.py','--config',config,'--enqueue-date','2026-10-03','--enqueue-only'],{env,timeout:10000});
  const queued=await sql`SELECT source_type FROM data_import_runs WHERE status='queued'`;expect(queued).toHaveLength(3);expect(queued.every(row=>row.source_type!=='book_stock')).toBe(true);
  execFileSync(python,['tests/support/simple-query-worker.py','--config',config,'--enqueue-date','2026-10-01','--enqueue-only'],{env,timeout:10000});
  expect((await sql`SELECT count(*)::int AS n FROM data_import_runs WHERE status='queued'`)[0].n).toBe(3);
 }finally{server.kill('SIGTERM');}
});
