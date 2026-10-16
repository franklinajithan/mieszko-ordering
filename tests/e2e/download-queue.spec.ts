import {test,expect} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync,mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';
const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
const headers={origin:'http://127.0.0.1:3100'};
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});test.afterAll(async()=>{await sql.end();});
async function job(status='queued',day='2026-10-07',storeId=1){return Number((await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date) VALUES(${storeId},'normal_sales','manual',${status},${day},${day}) RETURNING id`)[0].id);}

test('queue screen separates stages, pauses, resumes with a new ID, cancels and re-downloads',async({page,request})=>{
 const waiting=await job();const success=await job('success','2026-10-06');await job('downloading','2026-10-05',2);await job('failed','2026-10-04');
 await page.goto('/downloads');await expect(page.getByRole('heading',{name:'Download Queue',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Processing (1)',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Pause job '+waiting,exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Waiting (1)',exact:true}).click();await page.getByRole('button',{name:'Pause job '+waiting,exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Report paused.'})).toBeVisible();await expect(page.getByRole('button',{name:'Paused (1)',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Paused (1)',exact:true}).click();await page.getByRole('button',{name:'Resume job '+waiting,exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Fresh download queued'})).toBeVisible();
 const [newest]=await sql`SELECT id,details FROM data_import_runs ORDER BY id DESC LIMIT 1`;expect(newest.details.retry_of).toBe(waiting);expect(Number(newest.id)).not.toBe(waiting);
 await page.getByRole('button',{name:'Waiting (1)',exact:true}).click();await page.getByRole('button',{name:'Cancel job '+newest.id,exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Report cancelled.'})).toBeVisible();
 await page.getByRole('button',{name:'Cancelled (1)',exact:true}).click();await page.getByRole('button',{name:'Re-download job '+newest.id,exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Fresh download queued'})).toBeVisible();
 const duplicate=await request.post('/api/download-queue',{headers,data:{runId:Number(newest.id),action:'redownload'}});expect(duplicate.status()).toBe(200);expect((await duplicate.json()).data.message).toContain('already queued');
 expect((await request.post('/api/download-queue',{headers,data:{runId:success,action:'redownload'}})).status()).toBe(200);
 const filtered=await request.get('/api/download-queue?storeId=2&view=processing');expect((await filtered.json()).data.rows.every((r:{store_id:number})=>r.store_id===2)).toBe(true);
 expect((await request.post('/api/download-queue',{headers:{origin:'https://other.example'},data:{runId:waiting,action:'cancel'}})).status()).toBe(403);
 expect((await request.get('/api/download-queue?view=invalid')).status()).toBe(400);
});

test('queue controls protect committing imports and do not report user pauses as import failures',async({request})=>{
 const id=await job('importing');expect((await request.post('/api/download-queue',{headers,data:{runId:id,action:'cancel'}})).status()).toBe(400);
 expect((await sql`SELECT status FROM data_import_runs WHERE id=${id}`)[0].status).toBe('importing');
 const waiting=await job('queued','2026-10-08');await request.post('/api/download-queue',{headers,data:{runId:waiting,action:'pause'}});
 const quality=(await (await request.get('/api/data-quality?storeId=1&type=import_failure')).json()).data;expect(quality.total).toBe(0);
 const summary=(await (await request.get('/api/data-operations/status')).json()).rows;expect(summary.find((r:{store_id:number;source_type:string})=>r.store_id===1&&r.source_type==='normal_sales').status).toBe('paused');
 expect((await request.post('/api/data-operations/retry',{headers,data:{runId:waiting}})).status()).toBe(400);
});

for(const action of ['pause','cancel'] as const)test(`active ${action} prevents an older worker from importing after its download finishes`,async({request})=>{
 await sql`UPDATE daily_sales SET sold_qty=9 WHERE store_product_id=11 AND sales_date='2026-10-07'`;
 const id=await job();const folder=mkdtempSync(path.join(tmpdir(),'mieszko-controls-'));const ready=path.join(folder,'ready'),release=path.join(folder,'release'),config=path.join(folder,'config.json');
 writeFileSync(config,JSON.stringify({download_directory:path.join(folder,'downloads'),app_directory:process.cwd(),stores:{'1':{erp:'msp',feeds:{normal_sales:{complete_store_report:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Sold Qty',date:'Sales Date'},command:['python','tests/support/controlled-crm.py',ready,release,'--output','{output}','--source','{source}','--start','{start}','--store','{store_id}']}}}}}));
 const child=spawn('python',['tests/support/simple-query-worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection}});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const finished=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 try{
  await expect.poll(()=>existsSync(ready)).toBe(true);
  const controlled=await request.post('/api/download-queue',{headers,data:{runId:id,action}});expect(controlled.status(),await controlled.text()).toBe(200);
  writeFileSync(release,'continue');expect(await finished,output).toBe(0);
  const [row]=await sql`SELECT status,details FROM data_import_runs WHERE id=${id}`;expect(row.status).toBe('failed');expect(row.details.queue_control).toBe(action==='pause'?'paused':'cancelled');
  // Fixture would replace normal sales with four; the previous nine must survive.
  expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`)[0].sold_qty)).toBe(9);
  expect(Number((await sql`SELECT rtc_qty FROM rtc_sales WHERE store_product_id=11 AND rtc_date='2026-10-07'`)[0].rtc_qty)).toBe(1);
  if(action==='pause'){
   const response=await request.post('/api/download-queue',{headers,data:{runId:id,action:'resume'}});expect(response.status()).toBe(200);expect((await response.json()).data.runId).not.toBe(id);
  }
 }finally{writeFileSync(release,'release');child.kill('SIGTERM');await finished;}
});
