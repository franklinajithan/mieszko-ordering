import {test, expect} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync} from 'node:fs';
const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{
  await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));
  await sql`INSERT INTO store_crm_settings(store_id,crm_url) VALUES(1,'http://127.0.0.1:3201/')`;
});
test.afterAll(async()=>{await sql.end();});
test('monitoring explains product review, retains verified zero reports and queues missing dates',async({page,request})=>{
  await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,imported_at,imported_row_count,details)
    VALUES(1,'normal_sales','nightly','success','2026-10-21','2026-10-21',now(),1223,'{"has_unmatched_products":true,"partial_import":true,"unmatched_identifier_count":1,"review_message":"1223 matched rows saved; 1 unmatched identifier moved to Unmatched Products."}'),
    (1,'wastage','nightly','success','2026-10-21','2026-10-21',now(),0,'{"zero_activity":true}')`;
  const response=await request.get('/api/data-operations/status');
  expect(response.ok()).toBe(true);
  const {rows}=await response.json();
  expect(rows.find((r:{source_type:string;store_id:number})=>r.store_id===1&&r.source_type==='normal_sales')).toMatchObject({status:'partial',crm_configured:true,unmatched_identifier_count:'1'});
  await page.goto('/');
  const monitor=page.getByRole('region',{name:'Live data import monitoring'});
  await expect(monitor.getByText('Completed · product review',{exact:true})).toBeVisible();
  await monitor.getByText('Why product review?',{exact:true}).click();
  await expect(monitor.getByRole('link',{name:'Review unmatched products'})).toBeVisible();
  await expect(monitor.getByText('Zero wastage · Report date available',{exact:true})).toBeVisible();
  const unconfigured=monitor.getByRole('row').filter({has:page.getByRole('rowheader').filter({hasText:'Perivale'})});
  await expect(unconfigured.getByRole('button',{name:'Refresh book stock'})).toBeDisabled();
  await monitor.getByText('Check missing report dates and download',{exact:true}).click();
  await monitor.getByLabel('From',{exact:true}).fill('2026-10-21');
  await monitor.getByLabel('To',{exact:true}).fill('2026-10-21');
  const coverage=monitor.getByRole('region',{name:'Report date coverage'});
  await expect(coverage.getByRole('button',{name:'Download Hounslow RTC Sales 2026-10-21',exact:true})).toBeVisible();
  await expect(coverage.getByRole('button',{name:'Download Hounslow Wastage 2026-10-21',exact:true})).toHaveCount(0);
  await coverage.getByRole('button',{name:'Download Hounslow RTC Sales 2026-10-21',exact:true}).click();
  await expect(coverage.getByRole('status').filter({hasText:'Download queued'})).toBeVisible();
  expect(await sql`SELECT id FROM data_import_runs WHERE source_type='rtc' AND store_id=1`).toHaveLength(1);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);
});

test('monitoring API keeps partial and zero imports available and prevents duplicate recovery',async({request})=>{
  await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,imported_at,imported_row_count,details)
    VALUES(1,'normal_sales','nightly','success','2026-10-21','2026-10-21',now(),1223,'{"has_unmatched_products":true,"partial_import":true,"unmatched_identifier_count":1,"review_message":"Matched rows saved."}'),
    (1,'wastage','nightly','success','2026-10-21','2026-10-21',now(),0,'{"zero_activity":true}')`;
  const status=await request.get('/api/data-operations/status');
  expect(status.status()).toBe(200);
  const {rows}=await status.json();
  expect(rows.find((r:{store_id:number;source_type:string})=>r.store_id===1&&r.source_type==='normal_sales')).toMatchObject({status:'partial',review_message:'Matched rows saved.',unmatched_identifier_count:'1',crm_configured:true});
  expect(rows.find((r:{store_id:number;source_type:string})=>r.store_id===1&&r.source_type==='wastage')).toMatchObject({status:'success',zero_activity:true,latest_data_date:'2026-10-21',last_successful_row_count:0});
  expect(rows.find((r:{store_id:number})=>r.store_id===2)).toMatchObject({crm_configured:false});
  const coverage=await request.get('/api/automation/coverage?stores=1&feeds=normal_sales,rtc,wastage&from=2026-10-21&to=2026-10-21&missingOnly=false');
  expect(coverage.status()).toBe(200);
  const {data}=await coverage.json();
  expect(data).toMatchObject({expected:3,available:2,unavailable:1});
  expect(data.rows.find((r:{source_type:string})=>r.source_type==='wastage')).toMatchObject({can_download:false,available:true});
  const headers={origin:'http://127.0.0.1:3100'};
  for(const feed of ['normal_sales','wastage']) {
    const retained=await request.post('/api/automation/coverage',{headers,data:{storeId:1,feed,day:'2026-10-21'}});
    expect((await retained.json()).data.runId).toBe(null);
  }
  const body={storeId:1,feed:'rtc',day:'2026-10-21'};
  for(let i=0;i<2;i++) expect((await request.post('/api/automation/coverage',{headers,data:body})).status()).toBe(202);
  expect(await sql`SELECT id FROM data_import_runs WHERE source_type='rtc' AND store_id=1`).toHaveLength(1);
});
