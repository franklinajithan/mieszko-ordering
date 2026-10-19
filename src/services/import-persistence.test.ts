import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';

vi.mock('server-only', () => ({}));
const context = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/db', () => ({ get db() { return context.db; } }));
const client = new PGlite();
const pg = drizzle(client);
// Reproduce postgres-js' array result contract while running real PostgreSQL SQL.
function adapt(database: typeof pg): typeof pg {
  return new Proxy(database, { get(target, prop) {
    if (prop === 'execute') return async (...args: Parameters<typeof pg.execute>) => (await target.execute(...args)).rows;
    if (prop === 'transaction') return (callback: (tx: typeof pg) => Promise<unknown>) => target.transaction(tx => callback(adapt(tx as unknown as typeof pg)));
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
context.db = adapt(pg);
const queue = await import('./data-import-run.service');
const stock = await import('./book-stock/book-stock-import.service');
const { bookStockRepository } = await import('@/repositories/book-stock');
beforeAll(async () => {
  await client.exec(readFileSync('schema.sql','utf8'));
  await client.exec(`
    INSERT INTO stores(id,name,code,is_active) VALUES (1,'Test store','TEST',true),(2,'Inactive','OFF',false);
    INSERT INTO departments(id,name) VALUES (1,'Dairy');
    INSERT INTO products(id,name,department,order_department_id) VALUES (1,'Milk','Dairy',1),(2,'Butter','Dairy',1);
    INSERT INTO store_products(id,store_id,product_id,store_product_code) VALUES (1,1,1,'A'),(2,1,2,'B');
    INSERT INTO suppliers(id,name,code) VALUES (1,'Supplier One','MM');
    INSERT INTO supplier_products(id,product_id,supplier_id,supplier_code) VALUES (1,1,1,'MILK'),(2,2,1,'BUTTER');
    INSERT INTO supplier_prices(supplier_id,supplier_product_id,supplier_code,net_price,case_size,effective_date) VALUES (1,1,'MILK',2,'6','2026-10-01'),(1,2,'BUTTER',3,'6x1','2026-10-01');
  `);
  for (const name of ['data-import-runs', 'book-stock-staging']) await client.exec(readFileSync(`migrations/manual/2026-10-15-${name}.sql`, 'utf8'));
}, 30000);
beforeEach(async () => { await client.exec('TRUNCATE import_quality_observations, data_import_runs, book_stock, book_stock_import_stage, not_posted_deliveries, daily_sales, rtc_sales, wastage, orders RESTART IDENTITY CASCADE'); });
afterAll(async () => { await client.close(); });

describe('queue PostgreSQL persistence', () => {
  it('queues once, claims once, and requires importing before success', async () => {
    const first = await queue.queueBookStockRefresh(1);
    expect(await queue.queueBookStockRefresh(1)).toEqual({runId: first.runId, alreadyQueued: true});
    expect(await queue.claimNextBookStockRefresh()).toEqual({runId:first.runId,storeId:1});
    expect(await queue.claimNextBookStockRefresh()).toBeNull();
    await expect(queue.finishImportRun({runId:first.runId,importedRowCount:1})).rejects.toThrow();
    await queue.markImportRunStatus(first.runId,'downloaded');
    await queue.markImportRunStatus(first.runId,'importing');
    await queue.finishImportRun({runId:first.runId,importedRowCount:2});
    await queue.failImportRun(first.runId,'must not overwrite success');
    expect((await client.query('SELECT status FROM data_import_runs')).rows).toEqual([{status:'success'}]);
  });
  it('rejects inactive stores', async () => { await expect(queue.queueBookStockRefresh(2)).rejects.toThrow('Active store'); });
  it('marks abandoned jobs failed without reporting success', async () => {
    await queue.queueBookStockRefresh(1); await queue.claimNextBookStockRefresh();
    await client.exec("UPDATE data_import_runs SET started_at=now()-interval '3 hours'");
    expect(await queue.failStalledImportRuns()).toBe(1);
  });
});
const input = {storeId:1,bookStockDate:'2026-10-15', referenceColumn:'Code',quantityColumn:'Qty',fileName:'BK.xlsx',importedAt:'2026-10-15T10:00:00.000Z',totalRows:2};
describe('atomic stock snapshots', () => {
  it('rejects blank quantities instead of silently importing zero', async () => {
    await expect(stock.importBookStockChunk({...input,rows:[{Code:'A',Qty:''}]})).rejects.toThrow('rejected');
    expect((await client.query('SELECT * FROM book_stock_import_stage')).rows).toHaveLength(0);
  });
  it('keeps partial chunks invisible, then commits the complete snapshot', async () => {
    await stock.importBookStockChunk({...input,rows:[{Code:'A',Qty:'4'}]});
    expect((await client.query('SELECT * FROM book_stock')).rows).toHaveLength(0);
    await stock.importBookStockChunk({...input,rows:[{Code:'B',Qty:'-1'}]});
    expect((await client.query('SELECT * FROM book_stock')).rows).toHaveLength(2);
    expect((await client.query('SELECT * FROM book_stock_import_stage')).rows).toHaveLength(0);
  });
  it('retains previous stock when a later chunk has unmatched products', async () => {
    await client.exec("INSERT INTO book_stock(store_product_id,book_stock_qty,book_stock_date,imported_at) VALUES(1,9,'2026-10-14','2026-10-14T10:00:00Z')");
    await stock.importBookStockChunk({...input,rows:[{Code:'A',Qty:'4'}]});
    await expect(stock.importBookStockChunk({...input,rows:[{Code:'missing',Qty:'1'}]})).rejects.toThrow();
    expect((await bookStockRepository.latestQtyByStoreProductIds([1])).get(1)).toBe('9.0000');
  });
  it('pins a chosen snapshot even if a newer upload arrives', async () => {
    await client.exec("INSERT INTO book_stock(store_product_id,book_stock_qty,book_stock_date,imported_at) VALUES(1,9,'2026-10-14','2026-10-14T10:00:00Z'),(1,3,'2026-10-15','2026-10-15T10:00:00Z')");
    expect((await bookStockRepository.latestQtyByStoreProductIds([1],{1:'2026-10-14T10:00:00Z'})).get(1)).toBe('9.0000');
  });
  it('does not revive absent products from an older snapshot', async () => {
    await client.exec("INSERT INTO book_stock(store_product_id,book_stock_qty,book_stock_date,imported_at) VALUES(1,9,'2026-10-14','2026-10-14T10:00:00Z'), (2,5,'2026-10-15','2026-10-15T10:00:00Z')");
    expect(await bookStockRepository.latestQtyByStoreProductIds([1,2])).toEqual(new Map([[2,'5.0000']]));
  });
  it('bulk import rejects the entire snapshot when one product is unknown', async () => {
    await expect(stock.importBookStockBulk({...input,rows:[{Code:'A',Qty:'4'},{Code:'missing',Qty:'2'}]})).rejects.toThrow();
    expect((await client.query('SELECT * FROM book_stock')).rows).toHaveLength(0);
  });
});


describe('order generation through PostgreSQL and Excel export', () => {
  it('keeps feeds separate, persists options, saves adjustments and exports supplier tabs', async () => {
    await client.exec("INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) VALUES (1,'2026-10-08',10); INSERT INTO rtc_sales(store_product_id,rtc_date,rtc_qty) VALUES (1,'2026-10-08',2); INSERT INTO wastage(store_product_id,wastage_date,wastage_qty) VALUES (1,'2026-10-08',1)");
    const {generateOrderSheet, saveOrderSheetDraft, buildOrderSheetResult} = await import('./order-sheet.service');
    const {exportOrderToExcel} = await import('./orders/order-export.service');
    const ExcelJS = (await import('exceljs')).default;
    const result = await generateOrderSheet({storeIds:[1],supplierIds:[1],departmentIds:[1],orderDate:'2026-10-15',deliveryDate:'2026-10-16',includeBookStock:false,includeFutureDeliveries:false,includeRtc:true,includeWastage:true,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-08',endDate:'2026-10-08'}],shortfallPeriods:[{startDate:'2026-10-16',endDate:'2026-10-16'}]});
    const milk=result.items.find(item=>item.itemCode==='A')!;
    expect(milk.calculatedSoldQty).toBe('10.0000'); expect(milk.rtcQty).toBe('2.0000'); expect(milk.wastageQty).toBe('1.0000'); expect(milk.suggestedOrderQty).toBe('13.0000');
    expect((await client.query('SELECT include_book_stock FROM orders')).rows).toEqual([{include_book_stock:false}]);
    await saveOrderSheetDraft({orderId:result.orderId,items:[{orderItemId:milk.orderItemId,orderQty:'18',selected:true}]});
    expect((await client.query('SELECT estimated_line_cost FROM order_items WHERE id=$1',[milk.orderItemId])).rows).toEqual([{estimated_line_cost:'36.0000'}]);
    // Later feed corrections must not rewrite the audit explanation of a saved order.
    await client.exec("UPDATE daily_sales SET sold_qty=999");
    expect((await buildOrderSheetResult(result.orderId)).items.find(item=>item.itemCode==='A')?.periodSales).toEqual(['10.0000']);
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportOrderToExcel(result.orderId) as unknown as import('exceljs').Buffer);
    expect(workbook.getWorksheet('Supplier 1')?.getRow(3).getCell(4).value).toBe(18);
    await expect(saveOrderSheetDraft({orderId:result.orderId,items:[{orderItemId:milk.orderItemId,orderQty:'1',selected:true},{orderItemId:999999,orderQty:'2',selected:true}]})).rejects.toThrow('does not belong');
    expect((await client.query('SELECT final_order_qty FROM order_items WHERE id=$1',[milk.orderItemId])).rows).toEqual([{final_order_qty:'18.0000'}]);
  });
});

describe('supplier orders and retained manual quantities',()=>{
  const generateInput={storeIds:[1],supplierIds:[1],departmentIds:[1],orderDate:'2026-10-15',deliveryDate:'2026-10-16',includeBookStock:false,includeFutureDeliveries:false,includeRtc:true,includeWastage:true,soldQtyMethod:'average' as const,comparisonPeriods:[{startDate:'2026-10-08',endDate:'2026-10-08'}],shortfallPeriods:[{startDate:'2026-10-16',endDate:'2026-10-16'}]};
  it('preserves manual units on regeneration and exports the supplier snapshot',async()=>{
    await client.exec("INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) VALUES(1,'2026-10-08',10)");
    const {generateOrderSheet,saveOrderSheetDraft}=await import('./order-sheet.service');
    const {generateSupplierOrders,listSupplierOrders,exportSupplierOrder}=await import('./orders/supplier-order.service');
    const first=await generateOrderSheet(generateInput);
    await saveOrderSheetDraft({orderId:first.orderId,items:first.items.map(item=>({orderItemId:item.orderItemId,orderQty:item.itemCode==='A'?'18':'0',selected:item.itemCode==='A'}))});
    await client.exec("UPDATE daily_sales SET sold_qty=30");
    const recalculated=await generateOrderSheet({...generateInput,orderId:first.orderId});
    const milk=recalculated.items.find(item=>item.itemCode==='A')!;
    expect(milk.orderQty).toBe('18.0000');expect(milk.suggestedOrderQty).toBe('30.0000');expect(milk.estimatedLineCost).toBe('36.0000');
    const drafts=await generateSupplierOrders(first.orderId,{acknowledgeWarnings:true});
    expect(drafts).toHaveLength(1);expect(drafts[0].lines[0].quantity).toBe('18.0000');expect(drafts[0].totalNetCost).toBe('36.0000');
    const download=await exportSupplierOrder(first.orderId,drafts[0].id,{acknowledgeWarnings:true});
    const ExcelJS=(await import('exceljs')).default;const book=new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(download.base64,'base64') as unknown as import('exceljs').Buffer);
    expect(book.worksheets[0].getRow(5).getCell(4).value).toBe(18);
    expect((await generateSupplierOrders(first.orderId,{acknowledgeWarnings:true}))[0].id).toBe(drafts[0].id);
    await saveOrderSheetDraft({orderId:first.orderId,items:[{orderItemId:milk.orderItemId,orderQty:'19',selected:true}]});
    expect((await listSupplierOrders(first.orderId))[0].stale).toBe(true);
    await expect(exportSupplierOrder(first.orderId,drafts[0].id,{acknowledgeWarnings:true})).rejects.toThrow('Regenerate');
  });
  it('blocks supplier generation if any selected line lacks a valid price',async()=>{
    const {generateOrderSheet,saveOrderSheetDraft}=await import('./order-sheet.service');
    const result=await generateOrderSheet(generateInput);
    await saveOrderSheetDraft({orderId:result.orderId,items:[{orderItemId:result.items[0].orderItemId,orderQty:'1',selected:true}]});
    await client.exec("UPDATE order_items SET price_status='check_missing_price', cheapest_supplier_id=NULL,cheapest_net_price=NULL");
    const {generateSupplierOrders}=await import('./orders/supplier-order.service');
    await expect(generateSupplierOrders(result.orderId,{acknowledgeWarnings:true})).rejects.toThrow('Pre-order validation');
    expect((await client.query('SELECT * FROM supplier_orders')).rows).toHaveLength(0);
  });
  it('reports separate coverage and recognizes verified zero-row imports',async()=>{
    const {getImportCoverage}=await import('./import-readiness.service');
    await client.exec("INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) VALUES(1,'2026-10-08',10); INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,imported_row_count) VALUES(1,'rtc','nightly','success','2026-10-08','2026-10-08',0)");
    const status=await getImportCoverage({storeIds:[1],comparisonPeriods:generateInput.comparisonPeriods,includeRtc:true,includeWastage:true});
    expect(status.coverage.map(row=>[row.source,row.availableStoreDays])).toEqual([['normal_sales',1],['rtc',1],['wastage',0]]);
    expect(status.warnings).toHaveLength(1);expect(status.warnings[0]).toContain('Wastage');
  });
});

describe('store-specific stock dates and order grouping',()=>{
  it('uses each store product and snapshot date even when item codes repeat',async()=>{
    await client.exec(`INSERT INTO stores(id,name,code,is_active) VALUES(3,'Other test store','OTHER',true) ON CONFLICT(id) DO NOTHING;
      INSERT INTO store_products(id,store_id,product_id,store_product_code) VALUES(3,3,1,'A') ON CONFLICT(id) DO NOTHING;
      INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) VALUES(1,'2026-10-08',10),(3,'2026-10-08',4);
      INSERT INTO book_stock(store_product_id,book_stock_date,book_stock_qty,imported_at) VALUES(1,'2026-10-15',20,'2026-10-15T10:00:00Z'),(3,'2026-10-14',5,'2026-10-14T10:00:00Z');`);
    const {generateOrderSheet,saveOrderSheetDraft}=await import('./order-sheet.service');
    const result=await generateOrderSheet({storeIds:[1,3],supplierIds:[1],departmentIds:[1],orderDate:'2026-10-15',deliveryDate:'2026-10-16',includeBookStock:true,includeFutureDeliveries:false,includeRtc:false,includeWastage:false,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-08',endDate:'2026-10-08'}],shortfallPeriods:[{startDate:'2026-10-16',endDate:'2026-10-16'}]});
    const first=result.items.find(item=>item.storeCode==='TEST'&&item.itemCode==='A')!;
    const other=result.items.find(item=>item.storeCode==='OTHER'&&item.itemCode==='A')!;
    expect(first.calculatedSoldQty).toBe('10.0000');expect(first.suggestedOrderQty).toBe('0.0000');
    expect(other.calculatedSoldQty).toBe('4.0000');expect(other.suggestedOrderQty).toBe('3.0000');
    await saveOrderSheetDraft({orderId:result.orderId,items:[{orderItemId:first.orderItemId,orderQty:'2',selected:true}]});
    const {generateSupplierOrders}=await import('./orders/supplier-order.service');
    expect((await generateSupplierOrders(result.orderId,{acknowledgeWarnings:true})).map(row=>[row.storeId,row.supplierId,row.lines[0].quantity]).sort()).toEqual([[1,1,'2.0000'],[3,1,'3.0000']]);
  });
  it('shows actual manual data separately from worker audit status',async()=>{
    await client.exec("INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) VALUES(1,'2026-10-15',8)");
    const {GET}=await import('@/app/api/data-operations/status/route');
    const response=await GET();const json=await response.json();
    expect(response.status).toBe(200);
    expect(json.rows.find((row:{store_id:number;source_type:string})=>row.store_id===1&&row.source_type==='normal_sales')).toMatchObject({latest_data_date:'2026-10-15',last_successful_import_at:null});
  });
});

it('retains microsecond snapshot identity from the Python worker',async()=>{
  await client.exec("INSERT INTO book_stock(store_product_id,book_stock_qty,book_stock_date,imported_at) VALUES(1,9,'2026-10-15','2026-10-15T10:00:00.123456Z')");
  const {getLatestBookStockSummary}=await import('./book-stock/apply-book-stock-to-order.service');
  const snapshot=await getLatestBookStockSummary(1);
  expect((await bookStockRepository.latestQtyByStoreProductIds([1],{1:snapshot!.importedAt})).get(1)).toBe('9.0000');
});
it('deletes only the exact microsecond Book Stock upload',async()=>{
 await client.exec("INSERT INTO book_stock(store_product_id,book_stock_qty,book_stock_date,imported_at) VALUES(1,9,'2026-10-15','2026-10-15T10:00:00.123456Z'),(1,8,'2026-10-15','2026-10-15T10:00:00.123789Z')");
 const {deleteBookStockForStoreUpload}=await import('./book-stock/book-stock-import.service');
 await deleteBookStockForStoreUpload(1,'2026-10-15T10:00:00.123456Z');
 expect((await client.query('SELECT book_stock_qty FROM book_stock')).rows).toEqual([{book_stock_qty:'8.0000'}]);
});

describe('active catalogue boundaries',()=>{
  const input={storeIds:[1],supplierIds:[1],departmentIds:[1],orderDate:'2026-10-15',deliveryDate:'2026-10-16',includeBookStock:false,includeFutureDeliveries:false,includeRtc:false,includeWastage:false,soldQtyMethod:'average' as const,comparisonPeriods:[{startDate:'2026-10-08',endDate:'2026-10-08'}],shortfallPeriods:[{startDate:'2026-10-16',endDate:'2026-10-16'}]};
  it('does not generate lines for globally inactive products',async()=>{
    await client.exec('UPDATE products SET is_active=false WHERE id=1');
    try {
      const {generateOrderSheet}=await import('./order-sheet.service');
      const result=await generateOrderSheet(input);
      expect(result.items.some(item=>item.itemCode==='A')).toBe(false);
      expect(result.items.some(item=>item.itemCode==='B')).toBe(true);
    }finally{await client.exec('UPDATE products SET is_active=true WHERE id=1');}
  });
  it('ignores a cheaper inactive supplier while retaining active quotes',async()=>{
    await client.exec(`INSERT INTO suppliers(id,name,code,is_active) VALUES(333,'Inactive offer','OFF333',false);
      INSERT INTO supplier_products(id,product_id,supplier_id,supplier_code) VALUES(333,1,333,'OFF-MILK');
      INSERT INTO supplier_prices(supplier_id,supplier_product_id,supplier_code,net_price,effective_date) VALUES(333,333,'OFF-MILK',0.1,'2026-10-01');`);
    try{
      const {generateOrderSheet}=await import('./order-sheet.service');
      const result=await generateOrderSheet({...input,supplierIds:[1,333]});
      const milk=result.items.find(item=>item.itemCode==='A')!;
      expect(milk.supplierQuotes.find(quote=>quote.isCheapest)?.supplierId).toBe(1);
    }finally{await client.exec('DELETE FROM supplier_prices WHERE supplier_id=333;DELETE FROM supplier_products WHERE supplier_id=333;DELETE FROM suppliers WHERE id=333;');}
  });
  it('rejects an inactive store before creating an order',async()=>{
    await client.exec('UPDATE stores SET is_active=false WHERE id=1');
    try{
      const {generateOrderSheet}=await import('./order-sheet.service');
      await expect(generateOrderSheet(input)).rejects.toThrow(/active store/i);
      expect((await client.query('SELECT id FROM orders')).rows).toHaveLength(0);
    }finally{await client.exec('UPDATE stores SET is_active=true WHERE id=1');}
  });
  it('returns an input error when browser refresh targets an inactive store',async()=>{
    const {POST}=await import('@/app/api/data-operations/book-stock/route');
    const response=await POST(new Request('http://localhost/api/data-operations/book-stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:2})}));
    expect(response.status).toBe(400);
    expect((await client.query<{id:number}>('SELECT id FROM data_import_runs')).rows).toHaveLength(0);
  });
});

it('never applies a previous supplier code price after remapping a product',async()=>{
  await client.exec("UPDATE supplier_products SET supplier_code='NEW-MILK' WHERE id=1");
  try{
    const {supplierPriceRepository}=await import('@/repositories/supplier-prices');
    expect(await supplierPriceRepository.getLatestPrice(1,'2026-10-15')).toBeNull();
    expect((await supplierPriceRepository.getLatestPricesForSupplierProducts([1],'2026-10-15')).has(1)).toBe(false);
    await client.exec("INSERT INTO supplier_prices(supplier_id,supplier_product_id,supplier_code,net_price,effective_date) VALUES(1,1,'NEW-MILK',4,'2026-10-01')");
    expect((await supplierPriceRepository.getLatestPrice(1,'2026-10-15'))?.netPrice).toBe('4.0000');
    expect((await supplierPriceRepository.getLatestPricesForSupplierProducts([1],'2026-10-15')).get(1)?.netPrice).toBe('4.0000');
  }finally{await client.exec("DELETE FROM supplier_prices WHERE supplier_code='NEW-MILK';UPDATE supplier_products SET supplier_code='MILK' WHERE id=1;");}
});

describe('operator import retry',()=>{
  it('preserves the failed audit and exact feed period, without duplicate queue entries',async()=>{
    await client.exec("INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,error_message) VALUES(1,'rtc','nightly','failed','2026-10-08','2026-10-09','Downloader timed out')");
    const original=Number((await client.query<{id:number}>('SELECT id FROM data_import_runs')).rows[0].id);
    const first=await queue.retryFailedImportRun(original);
    expect(first.alreadyQueued).toBe(false);
    expect(await queue.retryFailedImportRun(original)).toEqual({runId:first.runId,alreadyQueued:true});
    const rows=(await client.query('SELECT status,source_type,source_start_date::text AS source_start_date,source_end_date::text AS source_end_date,trigger_type,details,error_message FROM data_import_runs ORDER BY id')).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({status:'failed',error_message:'Downloader timed out'});
    expect(rows[1]).toMatchObject({status:'queued',source_type:'rtc',source_start_date:'2026-10-08',source_end_date:'2026-10-09',trigger_type:'retry',details:{retry_of:original}});
  });
  it('rejects retrying nonfailed or inactive-store jobs without creating work',async()=>{
    await queue.queueBookStockRefresh(1);
    await expect(queue.retryFailedImportRun(1)).rejects.toThrow('Failed import');
    await client.exec("INSERT INTO data_import_runs(store_id,source_type,trigger_type,status) VALUES(2,'normal_sales','nightly','failed')");
    await expect(queue.retryFailedImportRun(2)).rejects.toThrow('Active store');
    expect((await client.query<{id:number}>('SELECT id FROM data_import_runs')).rows).toHaveLength(2);
  });
});

it.each([['6',true],['6 x 1L',true],['1kg',true],['24pcs',true],['0',false],['0x12',false],['unknown',false],[null,false]] as const)('validates case-size reference %s without changing unit-price rules',async(value,expected)=>{
 const {validCaseSize}=await import('./operations/data-quality.service');expect(validCaseSize(value)).toBe(expected);
});

it.each([['normal_sales','2026-10-15',false],['normal_sales','2026-10-14',true],['book_stock','2026-10-15',true],['book_stock','2026-10-16',false]] as const)('uses consistent operational freshness for %s on %s',async(source,date,expected)=>{
 const {reportNeedsReview}=await import('@/utils/operations-freshness');expect(reportNeedsReview(source,date,'2026-10-16')).toBe(expected);
});

it('keeps supplier drafts current on an unchanged review and preserves omitted order notes',async()=>{
 const {generateOrderSheet,saveOrderSheetDraft}=await import('./order-sheet.service');
 const {orderRepository}=await import('@/repositories');
 const result=await generateOrderSheet({storeIds:[1],supplierIds:[1],departmentIds:[1],orderDate:'2026-10-15',deliveryDate:'2026-10-16',includeBookStock:false,includeFutureDeliveries:false,includeRtc:false,includeWastage:false,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-08',endDate:'2026-10-08'}],shortfallPeriods:[{startDate:'2026-10-16',endDate:'2026-10-16'}],comment:'Keep these office notes'});
 const before=await orderRepository.getById(result.orderId);
 await saveOrderSheetDraft({orderId:result.orderId,items:result.items.map(i=>({orderItemId:i.orderItemId,orderQty:i.orderQty,selected:i.selected}))});
 const after=await orderRepository.getById(result.orderId);expect(after?.revision).toBe(before?.revision);expect(after?.comment).toBe('Keep these office notes');
 await saveOrderSheetDraft({orderId:result.orderId,items:[{orderItemId:result.items[0].orderItemId,orderQty:'3',selected:true}]});
 expect((await orderRepository.getById(result.orderId))?.revision).toBe(before!.revision+1);expect((await orderRepository.getById(result.orderId))?.comment).toBe('Keep these office notes');
});
