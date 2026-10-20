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

test('failed daily report can be re-downloaded from its row without blocking on another queued date',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:origin,data:settings});
 const [failed]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,error_message)
 VALUES(1,'wastage','manual','failed','2026-10-14','2026-10-14','Fixture report parsing failed') RETURNING id`;
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date)
 VALUES(1,'wastage','manual','queued','2026-10-15','2026-10-15')`;
 await page.goto('/automation');
 await page.getByRole('checkbox',{name:'Hounslow',exact:true}).check();
 await page.getByLabel('From date',{exact:true}).fill('2026-10-14');
 await page.getByLabel('To date',{exact:true}).fill('2026-10-15');
 const retry=page.getByRole('button',{name:'Re-download Hounslow Wastage 2026-10-14',exact:true});
 await expect(retry).toBeVisible();await retry.click();
 await expect(page.getByRole('status').filter({hasText:'queued for a fresh download and import'})).toBeVisible();
 await expect(retry).toHaveCount(0);
 const runs=await sql`SELECT id,status,source_start_date::text AS day,details FROM data_import_runs WHERE store_id=1 AND source_type='wastage' ORDER BY id`;
 expect(runs).toHaveLength(3);expect(runs[0].status).toBe('failed');expect(runs[2]).toMatchObject({status:'queued',day:'2026-10-14',details:{retry_of:Number(failed.id)}});
 // Repeated clicks/API submissions return the same active retry, preserving its history.
 const repeated=await request.post('/api/data-operations/retry',{headers:origin,data:{runId:Number(failed.id)}});
 expect(repeated.status()).toBe(200);expect((await repeated.json()).data).toMatchObject({alreadyQueued:true,runId:Number(runs[2].id)});
 expect((await sql`SELECT id FROM data_import_runs`)).toHaveLength(3);
 expect((await request.post('/api/data-operations/retry',{headers:{origin:'https://foreign.example'},data:{runId:Number(failed.id)}})).status()).toBe(403);
 expect((await request.post('/api/data-operations/retry',{headers:origin,data:{runId:Number(runs[2].id)}})).status()).toBe(400);
 expect((await sql`SELECT book_stock_qty::text AS qty FROM book_stock WHERE store_product_id=11`)[0].qty).toBe('20.0000');
});

test('CRM UI saves changed store URLs and splits a range into three independent daily feeds',async({page,request})=>{
 await page.goto('/automation');
 await page.getByRole('textbox',{name:'Hounslow CRM URL'}).fill(settings.crmUrl);
 await page.getByRole('button',{name:'Save Hounslow CRM settings'}).click();
 await expect(page.getByRole('status').filter({hasText:'CRM settings saved'})).toContainText('CRM settings saved');
 await page.reload();await expect(page.getByRole('textbox',{name:'Hounslow CRM URL'})).toHaveValue(settings.crmUrl);
 await page.getByRole('textbox',{name:'Hounslow CRM URL'}).fill('http://127.0.0.1:3201/changed');
 await page.getByRole('button',{name:'Save Hounslow CRM settings'}).click();
 await expect(page.getByRole('status').filter({hasText:'CRM settings saved'})).toContainText('CRM settings saved');
 expect((await sql`SELECT crm_url FROM store_crm_settings WHERE store_id=1`)[0].crm_url).toBe('http://127.0.0.1:3201/changed');
 await page.getByRole('checkbox',{name:'Hounslow',exact:true}).check();
 await page.getByLabel('From date',{exact:true}).fill('2026-10-01');
 await page.getByLabel('To date',{exact:true}).fill('2026-10-03');
 await page.getByRole('button',{name:'Download and import daily reports'}).click();
 await expect(page.getByRole('status').filter({hasText:'daily report jobs queued'})).toContainText('9 daily report jobs queued');
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

test('historical Wastage button resumes partial batches and reports actual import progress',async({page,request})=>{
 await request.put('/api/automation/stores/1',{headers:origin,data:settings});
 await page.goto('/automation');
 await page.getByRole('checkbox',{name:'Hounslow',exact:true}).check();
 await page.getByRole('checkbox',{name:'Normal Sales',exact:true}).uncheck();
 await page.getByRole('checkbox',{name:'RTC Sales',exact:true}).uncheck();
 await page.getByLabel('From date',{exact:true}).fill('2026-06-03');
 await page.getByLabel('To date',{exact:true}).fill('2026-10-15');
 await expect(page.getByText('135 possible daily jobs', {exact:false})).toBeVisible();
 let calls=0;
 await page.route('**/api/automation/imports',async route=>{
  if(route.request().method()==='POST' && ++calls===2) return route.fulfill({status:503,json:{success:false,error:'Fixture temporary connection failure'}});
  return route.continue();
 });
 await page.getByRole('button',{name:'Download and import daily reports'}).click();
 await expect(page.getByText('Fixture temporary connection failure',{exact:true})).toBeVisible();
 await expect(page.getByText('31 jobs accepted in 1 completed date batches', {exact:false})).toBeVisible();
 expect((await sql`SELECT count(*)::int AS n FROM data_import_runs`)[0].n).toBe(31);
 await page.unroute('**/api/automation/imports');
 await page.getByRole('button',{name:'Download and import daily reports'}).click();
 await expect(page.getByText('104 daily report jobs queued; 31 existing attempts skipped.',{exact:false})).toBeVisible();
 const rows=await sql`SELECT store_id,source_type,source_start_date::text AS day,source_end_date::text AS last FROM data_import_runs`;
 expect(rows).toHaveLength(135);expect(rows.every(row=>row.store_id===1&&row.source_type==='wastage'&&row.day===row.last)).toBe(true);
 await sql`UPDATE data_import_runs SET status='success',imported_row_count=84 WHERE source_start_date='2026-06-03'`;
 await sql`UPDATE data_import_runs SET status='failed',error_message='Fixture report missing' WHERE source_start_date='2026-06-04'`;
 const progress=await request.get('/api/automation/imports?stores=1&feeds=wastage&from=2026-06-03&to=2026-10-15');
 expect(progress.status()).toBe(200);
 const data=(await progress.json()).data;
 expect(data.counts).toMatchObject({success:1,failed:1,queued:133});expect(data.total).toBe(135);
 await expect(page.getByLabel('Daily import progress').getByRole('status')).toContainText('1 completed · 0 partial · 1 failed · 133 queued');
 await expect(page.getByText('Fixture report missing',{exact:true})).toBeVisible();
 await request.post('/api/automation/imports',{headers:origin,data:{storeIds:[1],feeds:['wastage'],startDate:'2026-06-04',endDate:'2026-06-04',replaceCompleted:true}});
 const retry=(await (await request.get('/api/automation/imports?stores=1&feeds=wastage&from=2026-06-03&to=2026-10-15')).json()).data;
 expect(retry.total).toBe(135);expect(retry.counts).toMatchObject({success:1,failed:0,queued:134});
 const otherStore=(await (await request.get('/api/automation/imports?stores=2&feeds=wastage&from=2026-06-03&to=2026-10-15')).json()).data;
 expect(otherStore.total).toBe(0);
 expect((await request.get('/api/automation/imports?stores=1&feeds=book_stock&from=2026-06-03&to=2026-10-15')).status()).toBe(400);
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
  const command=[python,path.resolve('automation/nebula_download.py'),'--progress','--url','{crm_url}','--store-code','{store_code}','--source','{source}','--start','{start}','--end','{end}','--output','{output}'];
  const feeds=Object.fromEntries(['normal_sales','rtc','wastage'].map(source=>[source,{command,extension:'.xls',mapping:{code:'Item Code',quantity:'Qty'},complete_store_report:true,normalize_with_app_parsers:true,timeout_seconds:40}]));
  const config=path.join(folder,'config.json');writeFileSync(config,JSON.stringify({store_settings_source:'database',store_defaults:{feeds},download_directory:folder,app_directory:process.cwd(),node_executable:process.execPath}));
  const env={...process.env,DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55432/postgres',MIESZKO_CRM_LOGIN_CODE:'fixture-only'};
  const worker=(extra:string[]=[])=>execFileSync(python,['tests/support/simple-query-worker.py','--config',config,'--once',...extra],{env,timeout:95000}).toString();
  await request.post('/api/automation/imports',{headers:origin,data:{storeIds:[1],feeds:['normal_sales'],startDate:'2026-10-01',endDate:'2026-10-01'}});
  expect(worker()).toContain('failed');expect((await sql`SELECT status FROM data_import_runs`)[0].status).toBe('failed');
  // URL is changed through the API, without restarting/rebuilding/reconfiguring the worker.
  await request.put('/api/automation/stores/1',{headers:origin,data:settings});
  await request.post('/api/automation/imports',{headers:origin,data:{storeIds:[1],feeds:['normal_sales','rtc','wastage'],startDate:'2026-10-01',endDate:'2026-10-02',replaceCompleted:true}});
  await sql`UPDATE stores SET code='HNS' WHERE id=1`;
 const first=worker(['--max-jobs','1','--store-id','1']);expect(first,first).not.toContain('failed');
 expect((await sql`SELECT count(*)::int AS n FROM data_import_runs WHERE status='success'`)[0].n).toBe(1);
 expect((await sql`SELECT count(*)::int AS n FROM data_import_runs WHERE status='queued'`)[0].n).toBe(5);
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
  for (const source of ['normal_sales','rtc']) feeds[source].complete_store_report=false;
  writeFileSync(config,JSON.stringify({store_settings_source:'database',store_defaults:{feeds},download_directory:folder,app_directory:process.cwd(),node_executable:process.execPath}));
  const wastageOnly=worker(['--max-jobs','1']);expect(wastageOnly,wastageOnly).not.toContain('failed');
  const remaining=await sql`SELECT source_type FROM data_import_runs WHERE status='queued'`;
  expect(remaining.map(row=>row.source_type).sort()).toEqual(['normal_sales','rtc']);
  expect((await sql`SELECT count(*)::int AS n FROM wastage WHERE wastage_date='2026-10-03' AND store_product_id=11`)[0].n).toBe(1);
 }finally{server.kill('SIGTERM');}
});
