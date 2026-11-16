import { test,expect } from '@playwright/test';
import postgres from 'postgres';
import { readFileSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
const headers={origin:'http://127.0.0.1:3100'};
test.beforeEach(async()=>{
 await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));
 await sql`INSERT INTO store_crm_settings(store_id,crm_url) VALUES(1,'http://127.0.0.1:3201/'),(2,'http://127.0.0.1:3201/')`;
});
test.afterAll(async()=>{await sql.end();});
async function job(day:string,status='queued',store=1,feed='normal_sales',details={}) {
 return Number((await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,details) VALUES(${store},${feed},'manual',${status},${day},${day},${sql.json(details)}) RETURNING id`)[0].id);
}
const coverage=(from='2026-10-14',to='2026-10-18',extra='')=>`/api/automation/coverage?stores=1&feeds=normal_sales&from=${from}&to=${to}${extra}`;
const download={storeId:1,feed:'normal_sales',day:'2026-10-15'};

test('queue and CRM history use report dates rather than insertion order',async({request})=>{
 const newer=await job('2026-10-18'),older=await job('2026-10-14'),middle=await job('2026-10-16');
 const queue=(await (await request.get('/api/download-queue?storeId=1&view=queued')).json()).data;
 expect(queue.rows.map((row:{id:number})=>row.id)).toEqual([older,middle,newer]);
 expect(queue.live.next.map((row:{id:number})=>row.id)).toEqual([older,middle,newer]);
 const history=(await (await request.get('/api/automation/imports?stores=1&feeds=normal_sales&from=2026-10-14&to=2026-10-18')).json()).data;
 expect(history.recent.map((row:{day:string})=>row.day)).toEqual(['2026-10-14','2026-10-16','2026-10-18']);
});

for (const database of [true,false]) test(`worker claims oldest report date first (${database?'database':'legacy'} profile)`,async()=>{
 await job('2026-10-18'); const older=await job('2026-10-14'); await job('2026-10-16');
 const config=database?{store_settings_source:'database',store_defaults:{feeds:{normal_sales:{complete_store_report:true}}}}:{};
 const code=`import os,json,psycopg\nfrom automation.worker import claim\nwith psycopg.connect(os.environ['DATABASE_URL'],autocommit=True,prepare_threshold=None) as conn:\n print(json.dumps(claim(conn,json.loads(os.environ['FIXTURE_CONFIG'])),default=str))`;
 const result=JSON.parse(execFileSync('python',['-c',code],{env:{...process.env,DATABASE_URL:connection,FIXTURE_CONFIG:JSON.stringify(config)},encoding:'utf8',timeout:15000}));
 expect(result[0]).toBe(older);
 expect((await sql`SELECT status FROM data_import_runs WHERE id=${older}`)[0].status).toBe('downloading');
});

test('coverage identifies missing, failed, partial and waiting dates and counts completed reports only',async({request})=>{
 await job('2026-10-14','success');
 const partial=await job('2026-10-16','failed',1,'normal_sales',{partial_import:true,unknown_product_codes:['X']});
 await sql`INSERT INTO crm_partial_publications(store_id,source_type,report_date,run_id,data_sha256,published_row_count) VALUES(1,'normal_sales','2026-10-16',${partial},'fixture-partial',1)`;
 await job('2026-10-16','failed'); // A later download failure cannot hide retained partial quantities.
 await sql`INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) VALUES(11,'2026-10-16',4)`;
 await job('2026-10-17','failed');await job('2026-10-18');
 const result=(await (await request.get(coverage())).json()).data;
 expect(result).toMatchObject({expected:5,available:2,unavailable:3,pending:1,actionRequired:2,percentage:40});
 expect(result.rows.map((row:{day:string;status:string})=>[row.day,row.status])).toEqual([['2026-10-15','missing'],['2026-10-17','failed'],['2026-10-18','queued']]);
 expect(result.rows[0]).toMatchObject({can_download:true,reason:'Report data is not available for 2026-10-15.'});
 const all=(await (await request.get(coverage('2026-10-14','2026-10-18','&missingOnly=false'))).json()).data;
 expect(all.rows).toHaveLength(5);expect(all.rows[0].status).toBe('success');
});

test('a gap button queues just that date, deduplicates simultaneous clicks and becomes available after real fixture import',async({page,request})=>{
 await job('2026-10-14','success');await job('2026-10-18');
 await page.goto('/downloads');
 await page.getByLabel('Queue store',{exact:true}).selectOption('1');
 await page.getByLabel('Queue feed',{exact:true}).selectOption('normal_sales');
 await page.getByLabel('Coverage from date',{exact:true}).fill('2026-10-14');
 await page.getByLabel('Coverage to date',{exact:true}).fill('2026-10-18');
 const panel=page.getByRole('region',{name:'Report date coverage'});
 await expect(panel.getByRole('progressbar',{name:'Completed report coverage'})).toHaveAttribute('value','1');
 await expect(panel.getByRole('row',{name:'Hounslow Normal Sales 2026-10-15 coverage'})).toContainText('Report data is not available for 2026-10-15.');
 await panel.getByRole('button',{name:'Download Hounslow Normal Sales 2026-10-15',exact:true}).click();
 await expect(panel.getByRole('status').filter({hasText:'Download queued for 2026-10-15'})).toBeVisible();
 const requests=await Promise.all([request.post('/api/automation/coverage',{headers,data:download}),request.post('/api/automation/coverage',{headers,data:download})]);
 expect(requests.every(response=>response.status()===202)).toBe(true);
 expect(await sql`SELECT id FROM data_import_runs WHERE source_start_date='2026-10-15'`).toHaveLength(1);
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-gap-import-')),config=path.join(folder,'config.json');
 writeFileSync(config,JSON.stringify({download_directory:path.join(folder,'downloads'),app_directory:process.cwd(),stores:{'1':{erp:'msp',feeds:{normal_sales:{extension:'.xlsx',complete_store_report:true,normalize_with_app_parsers:true,mapping:{code:'Item Code',quantity:'Quantity'},command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once','--max-jobs','1'],{env:{...process.env,DATABASE_URL:connection},timeout:60000});
 await panel.getByRole('button',{name:'Check missing dates',exact:true}).click();
 await expect(panel.getByText('2 of 5 reports available · 40% complete',{exact:true})).toBeVisible();
 await expect(panel.getByRole('row',{name:'Hounslow Normal Sales 2026-10-15 coverage'})).toHaveCount(0);
 expect((await sql`SELECT status FROM data_import_runs WHERE source_start_date='2026-10-18'`)[0].status).toBe('queued');
 expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-15'`)[0].sold_qty)).toBe(4);
 const protectedResult=await request.post('/api/automation/coverage',{headers,data:download});expect((await protectedResult.json()).data.runId).toBe(null);
 await page.setViewportSize({width:390,height:844});
 await expect(panel.getByRole('button',{name:'Download Hounslow Normal Sales 2026-10-16',exact:true})).toBeVisible();
 await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);
 await panel.screenshot({path:'/tmp/mieszko-report-coverage-mobile.png'});
});

test('verified zero and prior successful reports survive failed or active retries; manual rows are not falsely marked missing',async({request})=>{
 await job('2026-10-08','success');await job('2026-10-08','downloading');
 await job('2026-10-09','success');await job('2026-10-09','failed');
 const result=(await (await request.get(coverage('2026-10-06','2026-10-09','&missingOnly=false'))).json()).data;
 expect(result).toMatchObject({expected:4,available:2,percentage:50});
 expect(result.rows[0]).toMatchObject({status:'unverified',has_rows:true});
 expect(result.rows[0].reason).toContain('Saved rows exist');
 expect(result.rows[2]).toMatchObject({available:true,status:'downloading',can_download:false});
 expect(result.rows[3]).toMatchObject({available:true,status:'success',can_download:false});
 expect((await (await request.post('/api/automation/coverage',{headers,data:{...download,day:'2026-10-09'}})).json()).data.runId).toBe(null);
});

test('gap recovery honours pause controls, requires configured active stores and rejects unsafe requests',async({request})=>{
 await job('2026-10-15','failed',1,'normal_sales',{queue_control:'paused'});
 expect((await request.post('/api/automation/coverage',{headers,data:download})).status()).toBe(400);
 expect((await request.post('/api/automation/coverage',{headers,data:{...download,storeId:3}})).status()).toBe(400);
 await sql`UPDATE stores SET is_active=false WHERE id=2`;
 expect((await request.post('/api/automation/coverage',{headers,data:{...download,storeId:2}})).status()).toBe(400);
 expect((await request.post('/api/automation/coverage',{headers:{origin:'https://other.example'},data:download})).status()).toBe(403);
 for (const data of [{...download,day:'2026-02-30'},{...download,day:'2999-01-01'},{...download,feed:'book_stock'}]) expect((await request.post('/api/automation/coverage',{headers,data})).status()).toBe(400);
 expect((await request.get(coverage('2025-01-01','2026-10-19'))).status()).toBe(400);
 expect((await request.get(coverage('2026-10-14','2026-10-18','&missingOnly=invalid'))).status()).toBe(400);
});

test('coverage checks the full selected range beyond the visible page and isolates store/feed totals',async({request})=>{
 const url='/api/automation/coverage?stores=1,2&feeds=normal_sales,rtc&from=2026-09-01&to=2026-09-30';
 await job('2026-09-02','success',1,'rtc');
 const first=(await (await request.get(url)).json()).data;
 expect(first).toMatchObject({expected:120,available:1,total:119,pages:3});expect(first.rows).toHaveLength(50);
 const last=(await (await request.get(url+'&page=3')).json()).data;
 expect(last.rows).toHaveLength(19);expect(last.rows.at(-1).day).toBe('2026-09-30');
 const scoped=(await (await request.get('/api/automation/coverage?stores=1&feeds=normal_sales&from=2026-09-02&to=2026-09-02')).json()).data;
 expect(scoped).toMatchObject({expected:1,available:0});
});

test('current report shows real recorded stage progress and CRM range view shares missing-date actions',async({page})=>{
 const id=await job('2026-10-14','downloaded');
 await page.goto('/downloads');
 const active=page.getByRole('article',{name:`Current job ${id}`});
 await expect(active.getByRole('progressbar',{name:`Job ${id} stage progress`})).toHaveAttribute('value','2');
 await expect(active).toContainText('Stage 2 of 4');
 await page.goto('/automation');await page.getByRole('checkbox',{name:'Hounslow',exact:true}).check();
 await page.getByLabel('From date',{exact:true}).fill('2026-10-14');await page.getByLabel('To date',{exact:true}).fill('2026-10-15');
 const panel=page.getByRole('region',{name:'Report date coverage'});
 await expect(panel.getByRole('progressbar',{name:'Completed report coverage'})).toHaveAttribute('max','6');
 await expect(panel.getByRole('button',{name:'Download Hounslow Normal Sales 2026-10-15',exact:true})).toBeVisible();
});

test('gap action does not duplicate an active legacy report without recorded dates',async({request})=>{
 const id=await job('2026-10-15','downloading');
 await sql`UPDATE data_import_runs SET source_start_date=NULL,source_end_date=NULL WHERE id=${id}`;
 const result=(await (await request.post('/api/automation/coverage',{headers,data:download})).json()).data;
 expect(result.runId).toBe(id);
 expect(await sql`SELECT id FROM data_import_runs`).toHaveLength(1);
});
