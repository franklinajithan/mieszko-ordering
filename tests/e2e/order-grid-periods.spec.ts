import {test,expect,type APIRequestContext} from '@playwright/test';
import postgres from 'postgres';
import {readFileSync} from 'node:fs';
import ExcelJS from 'exceljs';
const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1,prepare:false,onnotice:()=>{}});
const periods=[{startDate:'2026-10-01',endDate:'2026-10-03'},{startDate:'2026-10-10',endDate:'2026-10-12'}];
const input={storeIds:[1],supplierIds:[1,2,3],departmentIds:[1],orderDate:'2026-10-13',deliveryDate:'2026-10-15',includeBookStock:true,includeRtc:true,includeWastage:true,soldQtyMethod:'average',comparisonPeriods:periods,shortfallPeriods:[{startDate:'2026-10-15',endDate:'2026-10-17'}]};
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});test.afterAll(async()=>{await sql.end();});
async function generate(request:APIRequestContext,patch={}){const response=await request.post('/api/order-sheet/generate',{data:{...input,...patch}});const result=await response.json();expect(response.ok(),JSON.stringify(result)).toBe(true);return result.data;}
async function movements(){
 await sql`DELETE FROM rtc_sales WHERE store_product_id IN(11,21)`;await sql`DELETE FROM wastage WHERE store_product_id IN(11,21)`;
 await sql`INSERT INTO rtc_sales(store_product_id,rtc_date,rtc_qty) VALUES(11,'2026-09-30',8000),(11,'2026-10-01',1),(11,'2026-10-03',2.25),(11,'2026-10-05',9000),(11,'2026-10-10',5),(11,'2026-10-12',6.5),(11,'2026-10-13',7000),(21,'2026-10-01',999)`;
 await sql`INSERT INTO wastage(store_product_id,wastage_date,wastage_qty) VALUES(11,'2026-09-30',8000),(11,'2026-10-01',2),(11,'2026-10-03',3.5),(11,'2026-10-05',9000),(11,'2026-10-10',7),(11,'2026-10-12',8.25),(11,'2026-10-13',7000),(21,'2026-10-01',999)`;
 for(const period of periods)for(const source of ['normal_sales','rtc','wastage'])await sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,imported_at,imported_row_count) VALUES(1,${source},'manual','success',${period.startDate},${period.endDate},now(),2)`;
}
for(const method of ['average','max','min'])test(`comparison movements (${method}) include boundaries and exclude gaps, outside dates and other stores`,async({request})=>{
 await movements();const result=await generate(request,{soldQtyMethod:method});const milk=result.items.find((item:{storeProductId:number})=>item.storeProductId===11);
 expect(milk.periodRtc).toEqual(['3.2500','11.5000']);expect(milk.periodWastage).toEqual(['5.5000','15.2500']);expect(milk.rtcQty).toBe(method==='max'?'11.5000':method==='min'?'3.2500':'7.3750');expect(milk.wastageQty).toBe('10.3750');
 const [saved]=await sql`SELECT calculation_breakdown FROM order_items WHERE order_id=${result.orderId} AND store_product_id=11`;expect(saved.calculation_breakdown.orderSheet.periodRtc).toEqual(milk.periodRtc);
 await sql`UPDATE rtc_sales SET rtc_qty=0 WHERE store_product_id=11 AND rtc_date IN('2026-09-30','2026-10-05','2026-10-13')`;await sql`UPDATE wastage SET wastage_qty=0 WHERE store_product_id=11 AND wastage_date IN('2026-09-30','2026-10-05','2026-10-13')`;const clean=await generate(request,{soldQtyMethod:method});const compared=clean.items.find((item:{storeProductId:number})=>item.storeProductId===11);expect([compared.forecastMovementQty,compared.coverageDemandQty,compared.suggestedOrderQty]).toEqual([milk.forecastMovementQty,milk.coverageDemandQty,milk.suggestedOrderQty]);
});
test('dated period totals survive reload and exports; recalculation refreshes dates without losing manual quantities',async({request,page})=>{
 await movements();const result=await generate(request);const milk=result.items.find((item:{storeProductId:number})=>item.storeProductId===11);
 await request.put(`/api/order-sheet/${result.orderId}/draft`,{data:{items:[{orderItemId:milk.orderItemId,orderQty:'9.375',selected:true}]}});
 for(const type of ['export','export-dairy']){
  const response=await request.post(`/api/orders/${result.orderId}/${type}`,{headers:{origin:'http://127.0.0.1:3100'}});const data=await response.json();expect(response.ok(),JSON.stringify(data)).toBe(true);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(data.data.base64,'base64') as unknown as ExcelJS.Buffer);
  const sheet=workbook.getWorksheet(type==='export'?'Order':'Product')!;const header=type==='export'?sheet.getRows(1,sheet.rowCount)!.find(row=>row.getCell(1).value==='Store')!:sheet.getRow(1);const labels=header.values as ExcelJS.CellValue[];
  const row=sheet.getRows(header.number+1,sheet.rowCount-header.number)!.find(row=>row.getCell(type==='export'?labels.indexOf('Store product code'):1).value==='10001')!;
  expect(row.getCell(labels.indexOf(type==='export'?'Period 1 RTC (2026-10-01 to 2026-10-03)':'RTC 01.10.2026-03.10.2026')).value).toBe(3.25);
  expect(row.getCell(labels.indexOf(type==='export'?'Period 2 Wastage (2026-10-10 to 2026-10-12)':'Wastage 10.10.2026-12.10.2026')).value).toBe(15.25);
 }
 await sql`UPDATE rtc_sales SET rtc_qty=99 WHERE store_product_id=11 AND rtc_date='2026-10-01'`;
 await page.setViewportSize({width:1920,height:1080});await page.goto(`/orders/${result.orderId}`);const table=page.getByRole('table',{name:'Order products',exact:true});const viewport=page.getByRole('region',{name:'Order product grid'});await viewport.screenshot({path:'test-results/order-worksheet-prices.png'});await viewport.evaluate(element=>{element.scrollLeft=1100;});await viewport.screenshot({path:'test-results/order-worksheet-comparison-dates.png'});await expect(table.getByRole('columnheader',{name:/Period 1 · RTC/})).toContainText('1 Oct 2026');
 const explain=page.getByRole('button',{name:'Explain suggested quantity for MLEKPOL Milk 1L'});await explain.click();const comparison=page.getByRole('dialog').getByRole('table').filter({has:page.getByText('Comparison period movement totals',{exact:true})});await expect(comparison.getByRole('cell',{name:'3.2500',exact:true})).toBeVisible();await page.getByRole('dialog').press('Escape');
 const refreshed=await generate(request,{orderId:result.orderId,comparisonPeriods:[periods[1]]});const changed=refreshed.items.find((item:{storeProductId:number})=>item.storeProductId===11);expect(changed.periodRtc).toEqual(['11.5000']);expect(changed.periodWastage).toEqual(['15.2500']);expect(changed.orderQty).toBe('9.3750');
});
test('old snapshots show unavailable period values until recalculated, never invented zero totals',async({request,page})=>{
 const result=await generate(request);await sql`UPDATE order_items SET calculation_breakdown=calculation_breakdown #- '{orderSheet,periodRtc}' #- '{orderSheet,periodWastage}' WHERE order_id=${result.orderId}`;
 await page.goto(`/orders/${result.orderId}`);const table=page.getByRole('table',{name:'Order products',exact:true});await expect(table.getByRole('cell',{name:'Recalculate',exact:true}).first()).toBeVisible();
});
test('all-rows worksheet reaches beyond 1000 with row numbers, preserved edits and price above supplier code',async({request,page})=>{
 await sql.unsafe("INSERT INTO products(id,name,department,order_department_id) SELECT 10000+n,'Worksheet product '||lpad(n::text,4,'0'),'Dairy',1 FROM generate_series(1,1205) n; INSERT INTO store_products(id,store_id,product_id,store_product_code) SELECT 20000+n,1,10000+n,'V'||lpad(n::text,4,'0') FROM generate_series(1,1205) n");
 const result=await generate(request);expect(result.items.length).toBeGreaterThan(1000);await page.addInitScript(()=>localStorage.setItem('mieszko-order-table-v1',JSON.stringify({pageSize:200})));await page.goto(`/orders/${result.orderId}`);await expect(page.getByRole('combobox',{name:'Order table page size'})).toHaveValue('0');
 const grid=page.getByRole('region',{name:'Order product grid'});const table=grid.getByRole('table',{name:'Order products',exact:true});await expect(table).toHaveAttribute('aria-rowcount',String(result.items.length+1));expect(await table.locator('input[data-order-quantity]').count()).toBeLessThan(80);
 const milkRow=table.getByRole('row').filter({has:page.getByRole('cell',{name:'10001',exact:true})});const labels=await table.getByRole('columnheader').allTextContents();const colours:string[]=[];
 for(const code of ['MM','SP','WAB']){const cell=milkRow.getByRole('cell').nth(labels.findIndex(label=>label.trim()===code));const price=cell.locator('p').nth(0),supplierCode=cell.locator('p').nth(1);await expect(price).toHaveText(/^£\d+\.\d{4}$/);expect((await price.boundingBox())!.y).toBeLessThan((await supplierCode.boundingBox())!.y);expect(await price.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(await supplierCode.evaluate(node=>parseFloat(getComputedStyle(node).fontSize)));colours.push(await price.evaluate(node=>getComputedStyle(node).color));}expect(new Set(colours).size).toBe(3);
 const last=result.items[result.items.length-1];await page.getByRole('spinbutton',{name:'Go to product row'}).fill(String(result.items.length));await page.getByRole('spinbutton',{name:'Go to product row'}).press('Enter');const quantity=page.getByRole('textbox',{name:`Order quantity for ${last.productName} at Hounslow`});await expect(quantity).toBeFocused();await quantity.fill('2.5');
 const lastRow=table.getByRole('row').filter({has:quantity});await expect(lastRow.getByRole('cell').first()).toHaveText(String(result.items.length));await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Changes saved.'})).toBeVisible();
 await page.getByRole('textbox',{name:'Search order products'}).fill(last.itemCode);await expect(table.getByRole('row').filter({has:quantity}).getByRole('cell').first()).toHaveText('1');await expect(quantity).toHaveValue('2.5');
 await page.screenshot({path:'test-results/order-worksheet-filtered.png',fullPage:true});
 await page.getByRole('textbox',{name:'Search order products'}).fill('');await page.getByRole('combobox',{name:'Order table page size'}).selectOption('50');await page.getByRole('button',{name:'Next products',exact:true}).click();await expect(table.locator('tbody tr').first().getByRole('cell').first()).toHaveText('51');
});
