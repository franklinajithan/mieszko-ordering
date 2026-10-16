import {test,expect,type APIRequestContext} from '@playwright/test';
import postgres from 'postgres';import {readFileSync} from 'node:fs';import ExcelJS from 'exceljs';
const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1,prepare:false,onnotice:()=>{}});
const input={storeIds:[1],supplierIds:[1,2,3],departmentIds:[1],orderDate:'2026-10-08',deliveryDate:'2026-10-10',includeBookStock:true,includeFutureDeliveries:false,includeRtc:true,includeWastage:true,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-01',endDate:'2026-10-07'}],shortfallPeriods:[{startDate:'2026-10-10',endDate:'2026-10-12'}]};
async function generate(request:APIRequestContext,patch={}){const r=await request.post('/api/order-sheet/generate',{data:{...input,...patch}});expect(r.status(),await r.text()).toBe(200);return (await r.json()).data;}
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});test.afterAll(async()=>{await sql.end();});
test('operations: seven-store summary and pending supplier drafts follow Excel preparation',async({request,page})=>{
 const response=await request.get('/api/operations');expect(response.status(),await response.text()).toBe(200);const summary=(await response.json()).data;
 expect(summary.stores.map((s:{name:string})=>s.name)).toEqual(['Hounslow','Perivale','East Ham','Hayes','Gravesend','Watford','Streatham']);expect(summary.stores.every((s:{feeds:unknown[]})=>s.feeds.length===4)).toBe(true);
 const order=await generate(request);let current=(await (await request.get('/api/operations')).json()).data;expect(current.stores[0].ordersToday).toBe(1);
 const grouped=await request.post(`/api/orders/${order.orderId}/supplier-orders`,{data:{acknowledgeWarnings:true}});expect(grouped.status(),await grouped.text()).toBe(200);const group=(await grouped.json()).data[0];
 current=(await (await request.get('/api/operations')).json()).data;expect(current.stores[0].pendingSupplierOrders).toBe(1);expect(current.stores[1].pendingSupplierOrders).toBe(0);
 expect((await request.post(`/api/orders/${order.orderId}/supplier-orders/${group.id}/export`,{data:{acknowledgeWarnings:true}})).status()).toBe(200);
 current=(await (await request.get('/api/operations')).json()).data;expect(current.stores[0].pendingSupplierOrders).toBe(0);
 await sql`UPDATE orders SET calculated_at=now()-interval '2 days' WHERE id=${order.orderId}`;
 const milk=order.items.find((i:{storeProductId:number})=>i.storeProductId===11);
 await request.put(`/api/order-sheet/${order.orderId}/draft`,{data:{items:[{orderItemId:milk.orderItemId,orderQty:'13',selected:true}]}});
 current=(await (await request.get('/api/operations')).json()).data;expect(current.stores[0].ordersToday).toBe(0);
 await generate(request,{orderId:order.orderId});current=(await (await request.get('/api/operations')).json()).data;expect(current.stores[0].ordersToday).toBe(1);
 await page.goto('/operations');await expect(page.getByRole('heading',{name:'Office Operations Control Centre',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'East Ham operations'})).toBeVisible();
});

test('quality: every requested issue class, store isolation and filtered Excel export',async({request,page})=>{
 await sql.unsafe(`INSERT INTO products(id,name,department,order_department_id) VALUES(444,'  MLEKPOL Milk 1L  ','Dairy',1);
 INSERT INTO store_products(id,store_id,product_id,store_product_code) VALUES(144,1,444,'DUP');
 UPDATE supplier_products SET supplier_code='' WHERE id=12;
 UPDATE supplier_prices SET net_price=0 WHERE supplier_id=1 AND supplier_product_id=11;
 UPDATE supplier_prices SET case_size='0x12' WHERE supplier_id=3;
 UPDATE book_stock SET book_stock_qty=-3 WHERE store_product_id=11;
 INSERT INTO product_barcodes(store_id,store_product_id,barcode) VALUES(2,11,'CROSS-STORE-FIXTURE');
 INSERT INTO import_quality_observations(store_id,source_type,problem_type,reference) VALUES(1,'normal_sales','unknown_product_code','UNKNOWN-ONLY-STORE1'),(1,'rtc','unmatched_barcode','EAN-ONLY-STORE1');
 INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,error_message) VALUES(1,'normal_sales','manual','failed','Fixture unmatched identifiers');`);
 const response=await request.get('/api/data-quality?storeId=1');expect(response.status(),await response.text()).toBe(200);const data=(await response.json()).data;
 expect(data.total).toBeLessThan(100);expect(new Set(data.issues.map((i:{type:string})=>i.type))).toEqual(new Set(['duplicate_product','unknown_product_code','unmatched_barcode','missing_supplier_code','missing_price','invalid_case_size','missing_sales_date','negative_stock','no_recent_sales','inconsistent_import','import_failure']));expect(data.issues.every((i:{storeId:number})=>i.storeId===1)).toBe(true);
 const other=(await (await request.get('/api/data-quality?storeId=2&type=unknown_product_code')).json()).data;expect(other.total).toBe(0);
 const filtered=await request.get('/api/data-quality?storeId=1&supplierId=2&type=missing_supplier_code');expect((await filtered.json()).data.issues.every((i:{supplierId:number})=>i.supplierId===2)).toBe(true);
 const workbook=new ExcelJS.Workbook();const download=await request.get('/api/data-quality/export?storeId=1&supplierId=2&type=missing_supplier_code');expect(download.status()).toBe(200);await workbook.xlsx.load(await download.body() as unknown as ExcelJS.Buffer);expect(workbook.worksheets[0].rowCount).toBeGreaterThan(1);expect(workbook.worksheets[0].getRow(2).getCell(1).value).toBe('Hounslow');expect(workbook.worksheets[0].getRow(2).getCell(2).value).toBe('Spizarnia');
 await page.goto('/data-quality?storeId=1');await page.getByRole('combobox',{name:'Problem type'}).selectOption('negative_stock');await expect(page.getByText('Latest snapshot contains negative stock:',{exact:false})).toBeVisible();
 await sql`INSERT INTO product_barcodes(store_id,store_product_id,barcode) VALUES(1,11,'EAN-ONLY-STORE1')`;
 expect((await (await request.get('/api/data-quality?storeId=1&type=unmatched_barcode')).json()).data.total).toBe(0);
});

test('quality: verified zero reports cover dates and unavailable suppliers are not missing mappings',async({request})=>{
 await sql.unsafe("UPDATE supplier_products SET is_active=false WHERE id=12;INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,imported_row_count) VALUES(1,'rtc','nightly','success',current_date-1,current_date-1,0);");
 const mappings=(await (await request.get('/api/data-quality?storeId=1&supplierId=2&type=missing_supplier_code')).json()).data;expect(mappings.total).toBe(0);
 const dates=(await (await request.get('/api/data-quality?storeId=1&type=missing_sales_date')).json()).data;
 const [day]=await sql`SELECT (current_date-1)::text AS day`;expect(dates.issues.some((i:{message:string})=>i.message===`RTC Sales: no report/activity for ${day.day}.`)).toBe(false);
 const summary=(await (await request.get('/api/operations')).json()).data;expect(summary.stores[0].feeds.find((f:{source_type:string})=>f.source_type==='rtc').latest_data_date).toBe(day.day);
});

test('quality: manual imports retain unmatched codes and barcodes without creating products',async({request})=>{
 for(const mappingType of ['store_product_code','barcode']){
  const response=await request.post('/api/imports/daily-sales',{data:{storeId:1,mappingType,productColumn:'Code',quantityColumn:'Qty',manualSalesDate:'2026-10-07',rows:[{Code:`UNMATCHED-${mappingType}`,Qty:'3'}]}});expect(response.status(),await response.text()).toBe(200);
 }
 const rows=(await (await request.get('/api/data-quality?storeId=1&type=unknown_product_code')).json()).data;expect(rows.issues.some((i:{itemCode:string})=>i.itemCode==='UNMATCHED-store_product_code')).toBe(true);
 expect((await (await request.get('/api/data-quality?storeId=1&type=unmatched_barcode')).json()).data.total).toBe(1);
 expect(Number((await sql`SELECT count(*) FROM products`)[0].count)).toBe(3);
});

test('quality: grouped lookups preserve store snapshots and dated supplier price selection',async({request})=>{
 await sql.unsafe(`INSERT INTO book_stock(store_product_id,book_stock_date,book_stock_qty,imported_at) VALUES
 (11,'2026-10-07',-99,'2026-10-07T08:00:00Z'),
 (21,'2026-10-09',-7,'2026-10-09T08:00:00Z');
 UPDATE supplier_prices SET net_price=0 WHERE supplier_product_id=11 AND supplier_id=1;
 INSERT INTO supplier_prices(supplier_id,supplier_product_id,supplier_code,net_price,case_size,effective_date,valid_until)
 SELECT supplier_id,supplier_product_id,supplier_code,2,'12',current_date+1,NULL FROM supplier_prices WHERE supplier_product_id=11 AND supplier_id=1 LIMIT 1;
 INSERT INTO supplier_prices(supplier_id,supplier_product_id,supplier_code,net_price,case_size,effective_date,valid_until)
 SELECT supplier_id,supplier_product_id,supplier_code,2,'12',current_date-2,current_date-1 FROM supplier_prices WHERE supplier_product_id=11 AND supplier_id=1 LIMIT 1;`);
 const quality=async(query:string)=>(await (await request.get(`/api/data-quality?${query}`)).json()).data;
 expect((await quality('storeId=1&type=negative_stock')).total).toBe(0);
 const stock=await quality('storeId=2&type=negative_stock');expect(stock.total).toBe(1);expect(stock.issues[0].message).toContain('-7');
 const missing=await quality('storeId=1&supplierId=1&type=missing_price');expect(missing.total).toBe(1);expect(missing.issues[0].productId).toBe(1);
 expect((await quality('storeId=1&supplierId=2&type=missing_price')).total).toBe(0);
 // A correction must be visible immediately after the completed read, without a stale response cache.
 await sql`UPDATE supplier_prices SET net_price=2 WHERE supplier_product_id=11 AND supplier_id=1`;
 expect((await quality('storeId=1&supplierId=1&type=missing_price')).total).toBe(0);
 const summary=(await (await request.get('/api/operations')).json()).data;
 expect(summary.stores[0].feeds.find((f:{source_type:string})=>f.source_type==='book_stock').latest_data_date).toBe('2026-10-08');
 expect(summary.stores[1].feeds.find((f:{source_type:string})=>f.source_type==='book_stock').latest_data_date).toBe('2026-10-09');
});

test('diagnostics: credential-bearing errors, paths, filenames and arbitrary details are excluded',async({request,page})=>{
 await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_file_path,source_file_name,error_message,details) VALUES(1,'normal_sales','manual','failed','C:/password-SECRET','token-SECRET.xlsx','password=SECRET https://user:SECRET@example.test/?token=SECRET','{"token":"SECRET","retry_of":"password=SECRET","duplicate_of":"token=SECRET"}')`;
 const response=await request.get('/api/data-operations/diagnostics?storeId=1');expect(response.status()).toBe(200);expect(await response.text()).not.toContain('SECRET');expect((await response.json()).runs).toHaveLength(1);
 await page.goto('/operations');const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download diagnostic log',exact:true}).click();expect((await downloadPromise).suggestedFilename()).toBe('Mieszko-import-diagnostics.json');
});

test('validation: warnings require acknowledgement; changed mapping blocks generation and old draft export',async({request})=>{
 const order=await generate(request);const report=(await (await request.get(`/api/orders/${order.orderId}/validation`)).json()).data;expect(report.blockingCount).toBe(0);expect(report.warningCount).toBeGreaterThan(0);
 expect((await request.post(`/api/orders/${order.orderId}/supplier-orders`,{data:{}})).status()).toBe(400);
 const grouped=await request.post(`/api/orders/${order.orderId}/supplier-orders`,{data:{acknowledgeWarnings:true}});expect(grouped.status()).toBe(200);const group=(await grouped.json()).data[0];
 await sql`UPDATE supplier_products SET supplier_code='CHANGED-SP' WHERE id=12`;
 const changed=(await (await request.get(`/api/orders/${order.orderId}/validation`)).json()).data;expect(changed.issues.some((i:{code:string;severity:string})=>i.code==='missing_mapping'&&i.severity==='blocking')).toBe(true);
 expect((await request.post(`/api/orders/${order.orderId}/supplier-orders/${group.id}/export`,{data:{acknowledgeWarnings:true}})).status()).toBe(400);
});

test('validation: inactive suppliers and negative quantities cannot bypass the export review',async({request})=>{
 const order=await generate(request);await sql`UPDATE suppliers SET is_active=false WHERE id=2`;await sql`UPDATE order_items SET final_order_qty=-1 WHERE order_id=${order.orderId} AND store_product_id=12`;
 const report=(await (await request.get(`/api/orders/${order.orderId}/validation`)).json()).data;
 expect(report.issues.some((i:{code:string})=>i.code==='inactive_supplier')).toBe(true);expect(report.issues.some((i:{code:string})=>i.code==='invalid_quantity')).toBe(true);
 expect((await request.post(`/api/orders/${order.orderId}/supplier-orders`,{data:{acknowledgeWarnings:true}})).status()).toBe(400);
});

test('trace and table: separate stock components, demand, saved stages, keyboard and persistent filters',async({request,page})=>{
 await sql.unsafe("INSERT INTO not_posted_deliveries(store_product_id,quantity,file_name) VALUES(11,2,'receipt.xlsx');INSERT INTO future_deliveries(store_product_id,quantity,file_name,expected_delivery_date) VALUES(11,5,'arrival.xlsx','2026-10-09');");
 const result=await generate(request,{includeFutureDeliveries:true});const milk=result.items.find((i:{storeProductId:number})=>i.storeProductId===11);
 expect([milk.bookStockQty,milk.receivedNotPostedQty,milk.futureDeliveryQty,milk.coverageDemandQty,milk.projectedStockQty,milk.suggestedOrderQty]).toEqual(['20.0000','2.0000','5.0000','16.5000','16.0000','0.5000']);
 await page.goto(`/orders/${result.orderId}`);await page.getByRole('button',{name:'Explain suggested quantity for MLEKPOL Milk 1L'}).click();const explanation=page.getByRole('region',{name:'Suggested quantity explanation'});await expect(explanation.getByText('Saved stock movement timeline',{exact:true})).toBeVisible();await expect(explanation.getByText('Coverage forecast demand',{exact:true})).toBeVisible();
 const quantity=page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'});await quantity.focus();await quantity.press('Enter');await expect(page.getByRole('textbox',{name:'Order quantity for Natural Yogurt 200G at Hounslow'})).toBeFocused();
 await page.getByRole('combobox',{name:'Order table page size'}).selectOption('50');await page.reload();await expect(page.getByRole('combobox',{name:'Order table page size'})).toHaveValue('50');
 await page.getByRole('combobox',{name:'Order table store'}).selectOption('0365');const another=await generate(request,{storeIds:[2]});await page.goto(`/orders/${another.orderId}`);await expect(page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Perivale'})).toBeVisible();
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage unavailable in fixture');};});await page.getByRole('combobox',{name:'Order table page size'}).selectOption('200');await expect(page.getByRole('combobox',{name:'Order table page size'})).toHaveValue('200');
});

test('recovery: operator confirmation, age and state guards retain data and require a separate retry',async({request,page})=>{
 const [run]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,started_at) VALUES(1,'normal_sales','nightly','downloading',now()-interval '3 hours') RETURNING id`;
 const id=Number(run.id);expect((await request.post('/api/data-operations/recover',{data:{runId:id,workerStopped:false}})).status()).toBe(400);
 await page.goto('/operations');const monitor=page.getByRole('region',{name:'Live data import monitoring'});await monitor.getByText('Recover interrupted import',{exact:true}).click();await monitor.getByRole('checkbox',{name:'I have checked that the office worker is stopped'}).check();await monitor.getByRole('button',{name:'Mark interrupted attempt failed'}).click();await expect(monitor.getByRole('status').filter({hasText:'Interrupted attempt marked failed'})).toBeVisible();
 expect((await sql`SELECT status FROM data_import_runs WHERE id=${id}`)[0].status).toBe('failed');expect(Number((await sql`SELECT count(*) FROM data_import_runs`)[0].count)).toBe(1);expect(Number((await sql`SELECT sold_qty FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'`)[0].sold_qty)).toBe(4);
 expect((await request.post('/api/data-operations/recover',{data:{runId:id,workerStopped:true}})).status()).toBe(400);
 const [recent]=await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status) VALUES(1,'rtc','nightly','downloading') RETURNING id`;
 expect((await request.post('/api/data-operations/recover',{data:{runId:Number(recent.id),workerStopped:true}})).status()).toBe(400);
});

test('office migration is repeatable in the disposable database',async()=>{
 const migration=readFileSync('migrations/manual/2026-10-16-office-operations.sql','utf8');await sql.unsafe(migration);await sql.unsafe(migration);
 expect((await sql`SELECT column_name FROM information_schema.columns WHERE table_name='supplier_orders' AND column_name='exported_at'`)).toHaveLength(1);
});
