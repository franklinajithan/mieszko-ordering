import { test,expect } from '@playwright/test';
import postgres from 'postgres';
import ExcelJS from 'exceljs';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1,prepare:false,onnotice:()=>{}});
const headers={origin:'http://127.0.0.1:3100'};
const input={storeIds:[1],supplierIds:[1,2,3],departmentIds:[1],orderDate:'2026-10-08',deliveryDate:'2026-10-10',includeBookStock:true,includeFutureDeliveries:false,includeRtc:true,includeWastage:true,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-01',endDate:'2026-10-07'}],shortfallPeriods:[{startDate:'2026-10-10',endDate:'2026-10-12'}],dayBySalesRequired:true,dayBySalesStartDate:'2026-10-01',dayBySalesEndDate:'2026-10-07'};
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});test.afterAll(async()=>{await sql.end();});
async function book(request:import('@playwright/test').APIRequestContext,orderId:number) {
 const response=await request.post(`/api/orders/${orderId}/export-dairy`,{headers});const result=await response.json();expect(response.status(),JSON.stringify(result)).toBe(200);
 const bytes=Buffer.from(result.data.base64,'base64'),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
 return {workbook,bytes,fileName:result.data.fileName};
}
function column(sheet:ExcelJS.Worksheet,name:string) {const values=sheet.getRow(1).values as ExcelJS.CellValue[];const index=values.indexOf(name);expect(index,`Column ${name}`).toBeGreaterThan(0);return index;}
function rowFor(sheet:ExcelJS.Worksheet,code:string) {const row=sheet.getRows(2,Math.max(0,sheet.rowCount-1))?.find(row=>row.getCell(1).value===code);expect(row,`Product ${code}`).toBeTruthy();return row!;}

test('dairy workbook matches reference sections, saves manual edits, preserves identifiers and exact decimals',async({request})=>{
 await sql`DELETE FROM daily_sales WHERE store_product_id=12`;await sql`DELETE FROM rtc_sales WHERE store_product_id=12`;await sql`DELETE FROM wastage WHERE store_product_id=12`;await sql`UPDATE book_stock SET book_stock_qty=0 WHERE store_product_id=12`;
 await sql`UPDATE store_products SET store_product_code='00002' WHERE id=12`;await sql`UPDATE product_barcodes SET barcode='0000000123456' WHERE store_product_id=12`;
 await sql`UPDATE book_stock SET book_stock_qty=-2.5 WHERE store_product_id=11`;
 const generated=await request.post('/api/order-sheet/generate',{data:input});const result=(await generated.json()).data;expect(generated.ok()).toBe(true);
 const milk=result.items.find((item:{storeProductId:number})=>item.storeProductId===11);
 await request.put(`/api/order-sheet/${result.orderId}/draft`,{data:{items:[{orderItemId:milk.orderItemId,orderQty:'13.125',selected:true}]}});
 const {workbook,bytes,fileName}=await book(request,result.orderId);
 expect(fileName).toBe('Hounslow Dairy Order 2026-10-08.xlsx');expect(workbook.worksheets.map(sheet=>sheet.name)).toEqual(['Product','NO Movement','Order details']);
 const sheet=workbook.getWorksheet('Product')!,row=rowFor(sheet,'10001');
 expect(row.getCell(column(sheet,'Average Sold Qty')).value).toMatchObject({result:Number(milk.calculatedSoldQty)});
 expect(row.getCell(column(sheet,'RTC')).value).toBe(Number(milk.rtcQty));expect(row.getCell(column(sheet,'Wastage')).value).toBe(Number(milk.wastageQty));
 expect(row.getCell(column(sheet,'Shop Order Qty')).value).toBe(13.125);
 expect(row.getCell(column(sheet,'Order Qty')).value).toBe(Number(milk.suggestedOrderQty));
 expect(row.getCell(column(sheet,'Book Stock 08.10.2026')).value).toBe(-2.5);
 expect(row.getCell(column(sheet,'Book Stock with Delivery')).value).toMatchObject({result:-2.5});
 expect(row.getCell(column(sheet,'Current Book Stock')).formula).toMatch(/^MAX\(0,/);
 expect(row.getCell(column(sheet,'01.10.2026-07.10.2026')).value).toBe(28);
 expect(row.getCell(column(sheet,'2026-10-01')).value).toBe(4);
 expect(row.getCell(column(sheet,'Shortfall')).value).toBe(Number(milk.shortageQty));
 expect(row.getCell(column(sheet,'Projected Stock at Delivery')).value).toBe(Number(milk.projectedStockQty));
 const supplierCode=milk.supplierQuotes.find((quote:{supplierId:number})=>quote.supplierId===1).supplierProductCode;
 expect(row.getCell(column(sheet,'MM Code')).value).toBe(supplierCode);
 expect(sheet.views[0]).toMatchObject({state:'frozen',ySplit:1});expect(sheet.getRow(1).height).toBe(48);expect(sheet.autoFilter).toBeTruthy();
 const quiet=workbook.getWorksheet('NO Movement')!,zero=rowFor(quiet,'00002');expect(zero.getCell(column(quiet,'InnerEan')).value).toBe('0000000123456');expect(zero.getCell(1).numFmt).toBe('@');expect(zero.getCell(column(quiet,'Shop Order Qty')).value).toBe(0);
 expect(workbook.getWorksheet('Order details')!.getColumn(2).values.join(' ')).toContain('saved order calculations');
 for(const tab of workbook.worksheets)tab.eachRow(data=>data.eachCell(cell=>expect(cell.type).not.toBe(ExcelJS.ValueType.Error)));
 writeFileSync('/tmp/mieszko-dairy-verified.xlsx',bytes);
 const cache=execFileSync('python',['-c',`import openpyxl
w=openpyxl.load_workbook('/tmp/mieszko-dairy-verified.xlsx',data_only=True)
s=w['Product']
print(s['${row.getCell(column(sheet,'Current Book Stock')).address}'].value)`],{encoding:'utf8'}).trim();
 expect(cache).toBe('0');
 expect(row.getCell(column(sheet,'Estimated Line Cost')).formula).toContain('ROUND(');
 expect(row.getCell(column(sheet,'Shop Order Qty')).dataValidation.type).toBe('decimal');
});

test('multi-store dairy export keeps identical product codes in separate store tabs',async({request})=>{
 const generated=await request.post('/api/order-sheet/generate',{data:{...input,storeIds:[1,2],soldQtyMethod:'max'}});const result=(await generated.json()).data;
 const {workbook}=await book(request,result.orderId);
 expect(workbook.worksheets.map(sheet=>sheet.name)).toEqual(['Hounslow Product','Hounslow NO Movement','Perivale Product','Perivale NO Movement','Order details']);
 for(const [store,multiple] of [['Hounslow',1],['Perivale',2]] as const) {
  const sheet=workbook.getWorksheet(`${store} Product`)!,row=rowFor(sheet,'10001');
  expect(row.getCell(column(sheet,'Highest Sold Qty')).value).toMatchObject({result:28*multiple});
 }
});

test('disabled sources stay blank and a manually ordered zero-activity product stays in Product',async({request})=>{
 await sql`DELETE FROM daily_sales WHERE store_product_id=12`;await sql`DELETE FROM rtc_sales WHERE store_product_id=12`;await sql`DELETE FROM wastage WHERE store_product_id=12`;await sql`UPDATE book_stock SET book_stock_qty=0 WHERE store_product_id=12`;
 const generated=await request.post('/api/order-sheet/generate',{data:{...input,includeBookStock:false,includeRtc:false,includeWastage:false,dayBySalesRequired:false}});const result=(await generated.json()).data;
 const quiet=result.items.find((item:{storeProductId:number})=>item.storeProductId===12);
 await request.put(`/api/order-sheet/${result.orderId}/draft`,{data:{items:[{orderItemId:quiet.orderItemId,orderQty:'2',selected:true}]}});
 const {workbook}=await book(request,result.orderId);const sheet=workbook.getWorksheet('Product')!,row=rowFor(sheet,'10002');
 expect(row.getCell(column(sheet,'Shop Order Qty')).value).toBe(2);
 for(const name of ['RTC (not used)','Wastage (not used)','Book Stock (not used)','Future Delivery (not used)','Current Book Stock'])expect(row.getCell(column(sheet,name)).value).toBeNull();
 expect(workbook.getWorksheet('NO Movement')!.rowCount).toBe(1);
});

test('dairy workbook browser button persists edits before downloading',async({page})=>{
  // Keep default comparison dates inside the seeded report coverage.
  await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z'));
 await page.goto('/order-sheet');await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
 const quantity=page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'});await expect(quantity).toBeVisible({timeout:45000});await quantity.fill('11');
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Dairy workbook',exact:true}).click();const download=await event;
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile((await download.path())!);
 const sheet=workbook.getWorksheet('Hounslow Product')??workbook.getWorksheet('Product');expect(sheet).toBeTruthy();
 expect(rowFor(sheet!,'10001').getCell(column(sheet!,'Shop Order Qty')).value).toBe(11);
});

test('dairy export rejects invalid orders and foreign-origin requests',async({request})=>{
 expect((await request.post('/api/orders/invalid/export-dairy',{headers})).status()).toBe(400);
 expect((await request.post('/api/orders/99999/export-dairy',{headers})).status()).toBe(400);
 expect((await request.post('/api/orders/1/export-dairy',{headers:{origin:'https://foreign.example'}})).status()).toBe(403);
});
