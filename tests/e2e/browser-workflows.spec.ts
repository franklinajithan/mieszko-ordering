import { test,expect } from '@playwright/test';
import postgres from 'postgres';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
const connection='postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';
const sql=postgres(connection,{max:1,prepare:false,onnotice:()=>{}});
const seed=readFileSync('tests/fixtures/seven-stores.sql','utf8');
const input={storeIds:[1],supplierIds:[1,2,3],departmentIds:[1],orderDate:'2026-10-08',deliveryDate:'2026-10-10',includeBookStock:true,includeFutureDeliveries:false,includeRtc:true,includeWastage:true,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-01',endDate:'2026-10-07'}],shortfallPeriods:[{startDate:'2026-10-10',endDate:'2026-10-12'}]};
test.beforeEach(async()=>{await sql.unsafe(seed);});test.afterAll(async()=>{await sql.end();});

test('browser: dashboard, live editing, supplier Excel and history',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const result=await (await request.post('/api/order-sheet/generate',{data:input})).json();expect(result.success).toBe(true);
  await page.goto('/');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Trading overview'})).toBeVisible();
  await page.goto(`/orders/${result.data.orderId}`);
  const quantity=page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'});
  await quantity.fill('13');
  const row=quantity.locator('xpath=ancestor::tr');await expect(row.getByText('£14.30',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('status')).toContainText('Changes saved.');
  await page.getByRole('button',{name:'Generate supplier orders',exact:true}).click();
  const panel=page.getByRole('region',{name:'Supplier orders'}); // section gets a region role from aria-label
  await expect(panel.getByText('Spizarnia',{exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await panel.getByRole('button',{name:'Download',exact:true}).click();const download=await downloadEvent;
  const file=await download.path();expect(file).not.toBeNull();const book=new ExcelJS.Workbook();await book.xlsx.readFile(file!);
  expect(book.worksheets[0].getRow(5).getCell(4).value).toBe(13);expect(book.worksheets[0].getRow(5).getCell(5).value).toBe(1.1);
  await page.getByRole('link',{name:'Order History',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Order history',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Reopen / export'}).first().click();await expect(page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'})).toHaveValue('13.0000');
  expect(errors).toEqual([]);
});

test('browser: Generate Order form saves current edits before workbook export',async({page})=>{
  await page.goto('/order-sheet');
  await page.getByRole('button',{name:'Generate Order Sheet',exact:true}).click();
  const quantity=page.getByRole('textbox',{name:'Order quantity for MLEKPOL Milk 1L at Hounslow'});
  await expect(quantity).toBeVisible({timeout:45000});await quantity.fill('11');
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();const download=await downloadEvent;
  const book=new ExcelJS.Workbook();await book.xlsx.readFile((await download.path())!);
  const sheet=book.getWorksheet('Order')!;let header=0;sheet.eachRow((row,n)=>{if(row.getCell(1).value==='Store')header=n;});
  const labels=sheet.getRow(header).values as string[];const qtyColumn=labels.indexOf('Final qty');
  const rows:ExcelJS.Row[]=[];sheet.eachRow((row,n)=>{if(n>header&&row.getCell(1).value==='Hounslow'&&row.getCell(2).value==='10001')rows.push(row);});
  expect(rows).toHaveLength(1);expect(rows[0].getCell(qtyColumn).value).toBe(11);
});

test('browser: manually queue Book Stock, run fixture downloader and worker, observe success',async({page,request})=>{
  await page.goto('/book-stock');const monitor=page.getByRole('region',{name:'Live data import monitoring'});
  await expect(monitor.getByRole('button',{name:'Refresh book stock'}).first()).toBeVisible();
  const hounslow=monitor.locator('tr').filter({hasText:'Hounslow'});
  await hounslow.getByRole('button',{name:'Refresh book stock'}).click();await expect(hounslow.getByText('queued',{exact:true})).toBeVisible();
  const folder=mkdtempSync(path.join(tmpdir(),'mieszko-worker-e2e-'));const config=path.join(folder,'config.json');
  writeFileSync(config,JSON.stringify({download_directory:path.join(folder,'downloads'),app_directory:process.cwd(),stores:{'1':{erp:'msp',feeds:{book_stock:{includes_negative_stock:true,normalize_with_app_parsers:true,extension:'.xlsx',mapping:{code:'Item Code',quantity:'Current Stock'},command:['python','tests/support/fixture-crm.py','--output','{output}','--source','{source}','--start','{start}','--store','{store_id}']}}}}}));
  execFileSync('python',['automation/worker.py','--config',config,'--once'],{env:{...process.env,DATABASE_URL:connection},timeout:30000});
  await monitor.getByRole('button',{name:'Refresh status'}).click();await expect(hounslow.getByText('Last attempt succeeded',{exact:true})).toBeVisible();
  const rows=await sql`SELECT book_stock_qty FROM book_stock WHERE store_product_id=11 ORDER BY imported_at DESC LIMIT 1`;expect(Number(rows[0].book_stock_qty)).toBe(25);
  const [snapshot]=await sql`SELECT book_stock_date::text AS book_stock_date FROM book_stock WHERE store_product_id=11 ORDER BY imported_at DESC LIMIT 1`;
  const date=new Date(String(snapshot.book_stock_date)+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+2);const delivery=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+2);
  const generated=await request.post('/api/order-sheet/generate',{data:{...input,orderDate:String(snapshot.book_stock_date),deliveryDate:delivery,shortfallPeriods:[{startDate:delivery,endDate:date.toISOString().slice(0,10)}]}});
  const result=await generated.json();expect(generated.status(),JSON.stringify(result)).toBe(200);
  const milk=result.data.items.find((item:{storeProductId:number})=>item.storeProductId===11);expect(Number(milk.currentStock)).toBe(25);
});

test('browser: dashboard totals, freshness warnings and all primary screens render correctly',async({page})=>{
 await sql.unsafe(`TRUNCATE daily_sales,rtc_sales,wastage;
 INSERT INTO daily_sales(store_product_id,sales_date,sold_qty) VALUES(11,(now() AT TIME ZONE 'Europe/London')::date,100),(21,(now() AT TIME ZONE 'Europe/London')::date,200);
 INSERT INTO rtc_sales(store_product_id,rtc_date,rtc_qty) VALUES(11,(now() AT TIME ZONE 'Europe/London')::date,7);
 INSERT INTO wastage(store_product_id,wastage_date,wastage_qty) VALUES(11,(now() AT TIME ZONE 'Europe/London')::date,3);
 INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,imported_at) VALUES(1,'normal_sales','nightly','success',now()-interval '3 days');`);
 await page.goto('/');const overview=page.getByRole('region',{name:'Trading overview'});
 for(const [label,value] of [['Active stores','7'],['Active products','3'],['Normal Sales units','300'],['RTC Sales units','7'],['Wastage units','3']]){
  await expect(overview.getByText(label,{exact:true}).locator('..').getByText(value,{exact:true})).toBeVisible();
 }
 await expect(page.getByText('Last success older than 36 hours',{exact:true})).toBeVisible();
 await expect(page.getByText('No successful worker import recorded',{exact:true}).first()).toBeVisible();
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 for(const route of ['/products','/stores','/departments','/daily-sales','/rtc','/wastage','/supplier-prices','/supplier-codes','/book-stock','/orders','/order-sheet']){
  const response=await page.goto(route);expect(response?.status(),route).toBe(200);await expect(page.locator('h1').first()).toBeVisible();
 }
 expect(errors).toEqual([]);
});
