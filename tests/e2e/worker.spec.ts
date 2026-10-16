import { test,expect } from '@playwright/test';
import postgres from 'postgres';
import ExcelJS from 'exceljs';
import { readFileSync,mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});test.afterAll(async()=>{await sql.end();});
function configFor(stores:number[],extra:Record<string,unknown>={}){
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-worker-system-'));const config=path.join(folder,'config.json');
 const entry={download_directory:path.join(folder,'downloads'),app_directory:process.cwd(),stores:Object.fromEntries(stores.map(id=>[String(id),{erp:'msp',feeds:Object.fromEntries(['normal_sales','rtc','wastage','book_stock'].map(source=>[source,{extension:'.xlsx',mapping:{code:'Item Code',quantity:'Quantity'},complete_store_report:true,includes_negative_stock:true,normalize_with_app_parsers:true,command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}'],...extra}]))}]))};
 writeFileSync(config,JSON.stringify(entry));return config;
}
function run(config:string,args:string[]=[],simpleProtocol=false){return execFileSync('python',[simpleProtocol?'tests/support/simple-query-worker.py':'automation/worker.py','--config',config,...args,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:60000,encoding:'utf8'});}

test('worker: seven-store scheduled Excel imports through dashboard, order and final supplier workbook',async({page,request})=>{
 const config=configFor([1,2,3,4,5,6,7]);run(config,['--enqueue-date','2026-10-07']);
 const jobs=await sql`SELECT source_type,status,count(*)::int AS count FROM data_import_runs GROUP BY source_type,status ORDER BY source_type`;
 expect(jobs.map(row=>[row.source_type,row.status,row.count])).toEqual([['normal_sales','success',7],['rtc','success',7],['wastage','success',7]]);
 for(let store=1;store<=7;store++){
  const [row]=await sql`SELECT d.sold_qty,r.rtc_qty,w.wastage_qty FROM daily_sales d JOIN rtc_sales r ON r.store_product_id=d.store_product_id AND r.rtc_date=d.sales_date JOIN wastage w ON w.store_product_id=d.store_product_id AND w.wastage_date=d.sales_date WHERE d.store_product_id=${store*10+1} AND d.sales_date='2026-10-07'`;
  expect([Number(row.sold_qty),Number(row.rtc_qty),Number(row.wastage_qty)]).toEqual([4*store,store,.5*store]);
 }
 run(config,['--enqueue-date','2026-10-07']);expect(Number((await sql`SELECT count(*) FROM data_import_runs`)[0].count)).toBe(21);
 expect((await sql`SELECT count(*) FROM data_import_runs WHERE source_type='book_stock'`)[0].count).toBe('0');
 await page.goto('/');await expect(page.getByRole('heading',{name:'Trading overview'})).toBeVisible();
 const generated=await request.post('/api/order-sheet/generate',{data:{storeIds:[1,2,3,4,5,6,7],supplierIds:[1,2,3],departmentIds:[1],orderDate:'2026-10-08',deliveryDate:'2026-10-10',includeBookStock:true,includeFutureDeliveries:false,includeRtc:true,includeWastage:true,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-01',endDate:'2026-10-07'}],shortfallPeriods:[{startDate:'2026-10-10',endDate:'2026-10-12'}]}});
 expect(generated.status()).toBe(200);const order=(await generated.json()).data;
 const milk=order.items.find((row:{storeProductId:number})=>row.storeProductId===11);expect(Number(milk.suggestedOrderQty)).toBe(7.5);
 expect((await request.put(`/api/order-sheet/${order.orderId}/draft`,{data:{items:[{orderItemId:milk.orderItemId,orderQty:'13',selected:true}]}})).status()).toBe(200);
 const grouped=await request.post(`/api/orders/${order.orderId}/supplier-orders`,{data:{acknowledgeWarnings:true}});expect(grouped.status()).toBe(200);const groups=(await grouped.json()).data;expect(groups).toHaveLength(7);
 const group=groups.find((row:{storeId:number})=>row.storeId===1);const exported=await request.post(`/api/orders/${order.orderId}/supplier-orders/${group.id}/export`,{data:{acknowledgeWarnings:true}});expect(exported.status()).toBe(200);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from((await exported.json()).data.base64,'base64'));expect(workbook.worksheets[0].getRow(5).getCell(4).value).toBe(13);
 const history=await request.get('/api/orders');expect((await history.json()).data.some((row:{id:number})=>row.id===order.orderId)).toBe(true);
 await page.goto(`/orders/${order.orderId}`);await expect(page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'})).toHaveValue('13.0000');

});

test('worker: unmatched report rolls back the entire feed and records failure',async()=>{
 const config=configFor([1],{command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}','--unknown']});
 run(config,['--enqueue-date','2026-10-07']);
 expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`)[0].sold_qty)).toBe(4);
 expect(Number((await sql`SELECT count(*) FROM data_import_runs WHERE status='failed'`)[0].count)).toBe(3);
 expect((await sql`SELECT imported_at FROM data_import_runs`).every(row=>row.imported_at===null)).toBe(true);
});

test('worker: repeated identical report is detected without faking a new import timestamp',async()=>{
 const config=configFor([1]);run(config,['--enqueue-date','2026-10-07']);
 const original=(await sql`SELECT * FROM data_import_runs WHERE source_type='normal_sales'`)[0];
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date) VALUES(1,'normal_sales','retry','2026-10-07','2026-10-07')`;
 run(config);
 const duplicate=(await sql`SELECT * FROM data_import_runs WHERE source_type='normal_sales' ORDER BY id DESC LIMIT 1`)[0];
 expect(duplicate.details.duplicate_of).toBe(Number(original.id));expect(new Date(duplicate.imported_at).getTime()).toBe(new Date(original.imported_at).getTime());
});

test('API: supplier-price import works using one database connection',async({request})=>{
 const response=await request.post('/api/imports/supplier-prices',{timeout:5000,data:{supplierId:2,referenceColumn:'Code',priceColumn:'Price',effectiveDate:'2026-10-08',fileName:'fixture.csv',rows:[{Code:'P1-S2',Price:'1.05'}]}});
 expect(response.status()).toBe(200);expect((await response.json()).data.matchedRows).toBe(1);
});

test('worker: empty reports fail safely and an explicit retry succeeds',async()=>{
 const config=configFor([1],{command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}','--empty']});
 run(config,['--enqueue-date','2026-10-07']);
 const failed=await sql`SELECT id,source_type,status FROM data_import_runs ORDER BY id`;expect(failed.every(row=>row.status==='failed')).toBe(true);
 const normal=failed.find(row=>row.source_type==='normal_sales')!;
 const good=configFor([1]);run(good,['--retry-run',String(normal.id)]);
 const last=(await sql`SELECT status,details FROM data_import_runs ORDER BY id DESC LIMIT 1`)[0];expect(last.status).toBe('success');expect(last.details.retry_of).toBe(Number(normal.id));
});

test('worker: database insertion failure rolls back the prior delete and marks failure',async()=>{
 await sql.unsafe("CREATE OR REPLACE FUNCTION fixture_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected test failure'; END $$; CREATE TRIGGER fixture_failure BEFORE INSERT ON daily_sales FOR EACH ROW EXECUTE FUNCTION fixture_fail_insert();");
 try{
  run(configFor([1]),['--enqueue-date','2026-10-07'],true);
  expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`)[0].sold_qty)).toBe(4);
  expect((await sql`SELECT status FROM data_import_runs WHERE source_type='normal_sales'`)[0].status).toBe('failed');
 }finally{await sql.unsafe('DROP TRIGGER fixture_failure ON daily_sales; DROP FUNCTION fixture_fail_insert();');}
});

test('worker: incorrect configured store identity is rejected before any import',async()=>{
 const config=configFor([1]);const data=JSON.parse(readFileSync(config,'utf8'));data.stores['1'].code='0766';writeFileSync(config,JSON.stringify(data));
 run(config,['--enqueue-date','2026-10-07']);
 expect((await sql`SELECT status,error_message FROM data_import_runs`).every(row=>row.status==='failed'&&row.error_message.includes('store identity'))).toBe(true);
});

// A corrected report can legitimately revert to the contents of an older import.
test('worker: an old fingerprint does not suppress a later correction',async()=>{
 const config=configFor([1]);run(config,['--enqueue-date','2026-10-07']);
 await sql`UPDATE daily_sales SET sold_qty=99 WHERE store_product_id=11 AND sales_date='2026-10-07'`;
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date,status,imported_at,details) VALUES(1,'normal_sales','retry','2026-10-07','2026-10-07','success',clock_timestamp(),' {"data_sha256":"intervening-corrected-report"}'::jsonb)`;
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date) VALUES(1,'normal_sales','retry','2026-10-07','2026-10-07')`;
 run(config);
 expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`)[0].sold_qty)).toBe(4);
 expect((await sql`SELECT details FROM data_import_runs ORDER BY id DESC LIMIT 1`)[0].details.duplicate_of).toBeUndefined();
});

test('worker: a manual data correction cannot be mistaken for an unchanged duplicate',async()=>{
 const config=configFor([1]);run(config,['--enqueue-date','2026-10-07']);
 await sql`UPDATE daily_sales SET sold_qty=99 WHERE store_product_id=11 AND sales_date='2026-10-07'`;
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date) VALUES(1,'normal_sales','retry','2026-10-07','2026-10-07')`;
 run(config);
 expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`)[0].sold_qty)).toBe(4);
 expect((await sql`SELECT details FROM data_import_runs ORDER BY id DESC LIMIT 1`)[0].details.duplicate_of).toBeUndefined();
});


test('worker: store markers are checked before the normalizer can discard them',async()=>{
 const config=configFor([1],{mapping:{code:'Item Code',quantity:'Quantity',store:'Store Code'},command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}','--report-store','0766']});
 run(config,['--enqueue-date','2026-10-07']);
 const runs=await sql`SELECT status,error_message FROM data_import_runs`;
 expect(runs).toHaveLength(3);expect(runs.every(row=>row.status==='failed'&&row.error_message.includes('another store'))).toBe(true);
 expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`)[0].sold_qty)).toBe(4);
});

test('worker: a matching store marker survives validation and imports all scheduled feeds',async()=>{
 const config=configFor([1],{mapping:{code:'Item Code',quantity:'Quantity',store:'Store Code'},command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}','--report-store','0365']});
 run(config,['--enqueue-date','2026-10-07']);
 const runs=await sql`SELECT status FROM data_import_runs`;expect(runs).toHaveLength(3);expect(runs.every(row=>row.status==='success')).toBe(true);
});
