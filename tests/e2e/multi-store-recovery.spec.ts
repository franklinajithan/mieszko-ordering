import {test,expect} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
const ids=[1,2,3,4,5,6,7,8,9];
const headers={origin:'http://127.0.0.1:3100'};
test.beforeEach(async()=>{
 await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));
 await sql`INSERT INTO stores(id,name,code) VALUES(8,'Eighth Store','0008'),(9,'Ninth Store','0009')`;
 await sql`INSERT INTO store_products(id,store_id,product_id,store_product_code) VALUES(81,8,1,'10001'),(91,9,1,'10001')`;
 await sql`INSERT INTO book_stock(store_product_id,book_stock_date,book_stock_qty,imported_at) VALUES(81,'2026-10-08',0,'2026-10-08T08:00:00Z'),(91,'2026-10-08',0,'2026-10-08T08:00:00Z')`;
 await sql`INSERT INTO store_crm_settings(store_id,crm_url) SELECT id,'http://127.0.0.1:3201/' FROM stores`;
});
test.afterAll(async()=>{await sql.end();});

test('nine-store coverage paginates every store and daily queue/progress deduplicate the selection',async({request})=>{
 const query=`stores=${[...ids,9].join(',')}&feeds=normal_sales,rtc,wastage&from=2026-10-01&to=2026-10-03&missingOnly=false`;
 const first=await request.get('/api/automation/coverage?'+query);expect(first.ok(),await first.text()).toBe(true);const data=(await first.json()).data;
 expect(data).toMatchObject({expected:81,total:81,pages:2,unavailable:81});
 const second=await request.get('/api/automation/coverage?'+query+'&page=2');const rows=[...data.rows,...(await second.json()).data.rows];expect(rows).toHaveLength(81);expect(new Set(rows.map(row=>`${row.store_id}:${row.source_type}:${row.day}`)).size).toBe(81);expect([...new Set(rows.map(row=>row.store_id))].sort((a,b)=>a-b)).toEqual(ids);
 const queued=await request.post('/api/automation/imports',{headers,data:{storeIds:[...ids,9],feeds:['rtc'],startDate:'2026-10-01',endDate:'2026-10-01'}});expect(queued.status(),await queued.text()).toBe(202);expect((await queued.json()).data.queued).toBe(9);
 const duplicate=await request.post('/api/automation/imports',{headers,data:{storeIds:ids,feeds:['rtc'],startDate:'2026-10-01',endDate:'2026-10-01'}});expect((await duplicate.json()).data.queued).toBe(0);
 const progress=await request.get(`/api/automation/imports?stores=${ids.join(',')}&feeds=rtc&from=2026-10-01&to=2026-10-01`);expect(progress.ok(),await progress.text()).toBe(true);expect((await progress.json()).data).toMatchObject({total:9,counts:{queued:9}});
 const invalid=await request.get(`/api/automation/coverage?stores=${ids.join(',')}&feeds=rtc&from=2025-01-01&to=2026-10-01`);expect(invalid.status()).toBe(400);expect((await invalid.json()).error).toContain('at most 366 days');
});

test('nine-store Generate offers the exact missing report, imports verified zero RTC and generates all stores',async({page})=>{
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,imported_row_count)
 SELECT s.id,feed,'manual','success',day,day,0 FROM stores s CROSS JOIN unnest(ARRAY['normal_sales','rtc','wastage']) feed CROSS JOIN generate_series('2026-09-17'::date,'2026-10-07'::date,interval '1 day') day WHERE NOT(s.id=9 AND feed='rtc' AND day='2026-10-07')`;
 await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));await page.goto('/order-sheet');
 await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
 const approval=page.getByRole('alertdialog');await expect(approval.getByText('Download missing reports?',{exact:true})).toBeVisible();await expect(approval.getByText('Ninth Store · 2026-10-07 · rtc',{exact:true})).toBeVisible();
 expect(await sql`SELECT id FROM orders`).toHaveLength(0);
 await approval.getByRole('button',{name:'Cancel',exact:true}).click();expect(await sql`SELECT id FROM data_import_runs WHERE status='queued'`).toHaveLength(0);
 await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();await approval.getByRole('button',{name:'Approve download of 1 reports',exact:true}).click();await expect(page.getByRole('progressbar',{name:'Recovery jobs finished'})).toHaveAttribute('aria-valuenow','0');
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-nine-store-'));const config=path.join(folder,'config.json');writeFileSync(config,JSON.stringify({download_directory:path.join(folder,'downloads'),app_directory:process.cwd(),stores:{'9':{erp:'msp',feeds:{rtc:{complete_store_report:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'RTC Qty'},command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}','--empty']}}}}}));
 execFileSync('python',['automation/worker.py','--config',config,'--once','--max-jobs','1'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
 await expect(approval.getByText('Reports downloaded and imported',{exact:true})).toBeVisible({timeout:25000});expect(await sql`SELECT id FROM orders`).toHaveLength(0);
 const [run]=await sql`SELECT status,imported_row_count FROM data_import_runs WHERE store_id=9 AND source_type='rtc' AND source_start_date='2026-10-07'`;expect(run).toMatchObject({status:'success',imported_row_count:0});
 await approval.getByRole('button',{name:'Proceed with order',exact:true}).click();await expect(page.getByRole('table',{name:'Order products',exact:true})).toBeVisible();
 const [saved]=await sql`SELECT store_ids FROM orders ORDER BY id DESC LIMIT 1`;expect([...saved.store_ids].sort((a,b)=>a-b)).toEqual(ids);
 const stores=await sql`SELECT DISTINCT sp.store_id FROM order_items i JOIN store_products sp ON sp.id=i.store_product_id`;expect(stores.map(row=>row.store_id).sort((a,b)=>a-b)).toEqual(ids);
});
