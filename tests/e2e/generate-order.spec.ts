import { test, expect, type APIRequestContext } from '@playwright/test';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1,prepare:false,onnotice:()=>{}});
const seed=readFileSync('tests/fixtures/seven-stores.sql','utf8');
const baseInput={storeIds:[1],supplierIds:[1,2,3],departmentIds:[1],orderDate:'2026-10-08',deliveryDate:'2026-10-10',includeBookStock:true,includeFutureDeliveries:false,includeRtc:true,includeWastage:true,soldQtyMethod:'average',comparisonPeriods:[{startDate:'2026-10-01',endDate:'2026-10-07'}],shortfallPeriods:[{startDate:'2026-10-10',endDate:'2026-10-12'}]};
async function generate(request:APIRequestContext,input:unknown=baseInput){const response=await request.post('/api/order-sheet/generate',{data:input});return {response,body:await response.json()};}
test.beforeEach(async()=>{await sql.unsafe(seed);});
test.afterAll(async()=>{await sql.end();});
type Case={name:string;patch?:Record<string,unknown>;setup?:string;quantity?:number;winner?:number|null;status?:number};
// Expected units were computed independently from the fixture:
// base movement=4 normal+1 RTC+0.5 wastage=5.5/day; 2 days depletion;
// 3 days coverage; max(0,16.5-max(0,20-11))=7.5, rounded to 2 decimals. Case size never enters it.
const cases:Case[]=[
 {name:'01 base separate movement feeds',quantity:7.5,winner:2},
 {name:'02 exclude RTC',patch:{includeRtc:false},quantity:2.5},
 {name:'03 exclude wastage',patch:{includeWastage:false},quantity:5},
 {name:'04 normal sales alone',patch:{includeRtc:false,includeWastage:false},quantity:0},
 {name:'05 ignore book stock',patch:{includeBookStock:false},quantity:16.5},
 {name:'06 negative stock',setup:'UPDATE book_stock SET book_stock_qty=-5 WHERE store_product_id=11',quantity:16.5},
 {name:'07 excess stock',setup:'UPDATE book_stock SET book_stock_qty=100 WHERE store_product_id=11',quantity:0},
 {name:'08 zero sales and losses',setup:'UPDATE daily_sales SET sold_qty=0 WHERE store_product_id=11;UPDATE rtc_sales SET rtc_qty=0 WHERE store_product_id=11;UPDATE wastage SET wastage_qty=0 WHERE store_product_id=11',quantity:0},
 {name:'09 unusually high sales',setup:'UPDATE daily_sales SET sold_qty=100000 WHERE store_product_id=11',quantity:300004.5},
 {name:'10 fractional unit demand',setup:'UPDATE daily_sales SET sold_qty=0.1 WHERE store_product_id=11;UPDATE rtc_sales SET rtc_qty=0 WHERE store_product_id=11;UPDATE wastage SET wastage_qty=0 WHERE store_product_id=11;UPDATE book_stock SET book_stock_qty=0 WHERE store_product_id=11',quantity:0.3},
 {name:'11 one supplier',patch:{supplierIds:[1]},quantity:7.5,winner:1},
 {name:'12 Wabar lowest unit price',setup:'UPDATE supplier_prices SET net_price=0.9 WHERE supplier_id=3',quantity:7.5,winner:3},
 {name:'13 larger case still wins by unit price',setup:"UPDATE supplier_prices SET case_size='1000' WHERE supplier_id=2",quantity:7.5,winner:2},
 {name:'14 skip zero supplier price',setup:'UPDATE supplier_prices SET net_price=0 WHERE supplier_id=2',quantity:7.5,winner:3},
 {name:'15 no valid offers',setup:'UPDATE supplier_prices SET net_price=0',quantity:7.5,winner:null},
 {name:'16 missing cheapest mapping',setup:'UPDATE supplier_products SET is_active=false WHERE id=12',quantity:7.5,winner:3},
 {name:'17 no product supplier mappings',setup:'UPDATE supplier_products SET is_active=false WHERE product_id=1',quantity:7.5,winner:null},
 {name:'18 equal price priority',setup:'UPDATE supplier_prices SET net_price=1.1',quantity:7.5,winner:1},
 {name:'19 future effective price excluded',setup:"INSERT INTO supplier_prices(supplier_id,supplier_product_id,supplier_code,net_price,effective_date) VALUES(2,12,'P1-S2',0.1,'2026-10-09')",quantity:7.5,winner:2},
 {name:'20 backdated reimport cannot replace current effective price',setup:"INSERT INTO supplier_prices(supplier_id,supplier_product_id,supplier_code,net_price,effective_date,imported_at) VALUES(2,12,'P1-S2',1.9,'2026-08-01','2026-10-07')",quantity:7.5,winner:2},
 {name:'21 one future arrival',patch:{includeFutureDeliveries:true},setup:"INSERT INTO future_deliveries(store_product_id,quantity,file_name,source,expected_delivery_date) VALUES(11,5,'fixture.xlsx','ocs','2026-10-09')",quantity:2.5},
 {name:'22 multiple future arrivals',patch:{includeFutureDeliveries:true},setup:"INSERT INTO future_deliveries(store_product_id,quantity,file_name,source,expected_delivery_date) VALUES(11,3,'a.xlsx','ocs','2026-10-09'),(11,4,'b.xlsx','ocs','2026-10-10')",quantity:0.5},
 {name:'23 arrival after horizon ignored',patch:{includeFutureDeliveries:true},setup:"INSERT INTO future_deliveries(store_product_id,quantity,file_name,source,expected_delivery_date) VALUES(11,100,'fixture.xlsx','ocs','2026-10-11')",quantity:7.5},
 {name:'24 snapshot-date arrival not counted twice',patch:{includeFutureDeliveries:true},setup:"INSERT INTO future_deliveries(store_product_id,quantity,file_name,source,expected_delivery_date) VALUES(11,100,'fixture.xlsx','ocs','2026-10-08')",quantity:7.5},
 {name:'25 future feed disabled',setup:"INSERT INTO future_deliveries(store_product_id,quantity,file_name,source,expected_delivery_date) VALUES(11,100,'fixture.xlsx','ocs','2026-10-09')",quantity:7.5},
 {name:'26 no future arrivals',patch:{includeFutureDeliveries:true},quantity:7.5},
 {name:'27 all seven stores isolated',patch:{storeIds:[1,2,3,4,5,6,7]},quantity:7.5},
 {name:'28 selected stores only',patch:{storeIds:[1,7]},quantity:7.5},
 {name:'29 duplicate selected IDs',patch:{storeIds:[1,1],supplierIds:[2,2]},quantity:7.5,winner:2},
 {name:'30 missing book stock is an input error',setup:'DELETE FROM book_stock WHERE store_product_id IN (11,12,13)',status:400},
 {name:'31 invalid calendar date',patch:{orderDate:'2026-02-30'},status:400},
 {name:'32 empty comparison periods',patch:{comparisonPeriods:[]},status:400},
 {name:'33 empty selected stores',patch:{storeIds:[]},status:400},
 {name:'34 delivery before order',patch:{deliveryDate:'2026-10-07'},status:400},
 {name:'35 undated future delivery is an input error',patch:{includeFutureDeliveries:true},setup:"INSERT INTO future_deliveries(store_product_id,quantity,file_name,source) VALUES(11,4,'fixture.xlsx','ocs')",status:400},
 {name:'36 missing historical day',setup:"DELETE FROM daily_sales WHERE store_product_id=11 AND sales_date='2026-10-07'",quantity:5.79},
 {name:'37 maximum across two comparison periods',patch:{soldQtyMethod:'max',comparisonPeriods:[{startDate:'2026-09-24',endDate:'2026-09-30'},{startDate:'2026-10-01',endDate:'2026-10-07'}]},setup:"UPDATE daily_sales SET sold_qty=2 WHERE store_product_id=11 AND sales_date BETWEEN '2026-09-24' AND '2026-09-30'",quantity:5.5},
 {name:'38 average across two comparison periods',patch:{comparisonPeriods:[{startDate:'2026-09-24',endDate:'2026-09-30'},{startDate:'2026-10-01',endDate:'2026-10-07'}]},setup:"UPDATE daily_sales SET sold_qty=2 WHERE store_product_id=11 AND sales_date BETWEEN '2026-09-24' AND '2026-09-30'",quantity:2.5},
 {name:'39 minimum across two comparison periods',patch:{soldQtyMethod:'min',comparisonPeriods:[{startDate:'2026-09-24',endDate:'2026-09-30'},{startDate:'2026-10-01',endDate:'2026-10-07'}]},setup:"UPDATE daily_sales SET sold_qty=2 WHERE store_product_id=11 AND sales_date BETWEEN '2026-09-24' AND '2026-09-30'",quantity:0},
 {name:'41 expired supplier offer',setup:"UPDATE supplier_prices SET valid_until='2026-10-07' WHERE supplier_id=2",quantity:7.5,winner:3},
 {name:'42 offer valid on inclusive expiry date',setup:"UPDATE supplier_prices SET valid_until='2026-10-08' WHERE supplier_id=2",quantity:7.5,winner:2},
 {name:'40 disjoint department filtering',patch:{departmentIds:[2]},quantity:6.75},
 {name:'46 remapped supplier code cannot reuse the old code price',setup:"UPDATE supplier_products SET supplier_code='REPLACED-CODE' WHERE id=12",quantity:7.5,winner:3},
 {name:'47 inactive cheapest supplier is excluded',setup:'UPDATE suppliers SET is_active=false WHERE id=2',quantity:7.5,winner:3},
 {name:'48 all selected suppliers inactive',setup:'UPDATE suppliers SET is_active=false',status:400},
 {name:'49 inactive store is an input error',setup:'UPDATE stores SET is_active=false WHERE id=1',status:400},
];
for(const scenario of cases) test(scenario.name,async({request})=>{
  if(scenario.setup) await sql.unsafe(scenario.setup);
  const input={...baseInput,...scenario.patch};const {response,body}=await generate(request,input);
  expect(response.status(),JSON.stringify(body)).toBe(scenario.status??200);
  if(scenario.status) return;
  expect(body.success).toBe(true);
  const item=body.data.items.find((row:{itemCode:string;storeCode:string})=>row.itemCode===(scenario.name.startsWith('40')?'10003':'10001')&&row.storeCode==='0365');
  expect(Number(item.suggestedOrderQty)).toBe(scenario.quantity);
  if(scenario.winner!==undefined) expect(item.supplierQuotes.find((quote:{isCheapest:boolean})=>quote.isCheapest)?.supplierId??null).toBe(scenario.winner);
  const storeIds=[...new Set(input.storeIds)];
  expect(new Set(body.data.items.map((row:{storeProductId:number})=>row.storeProductId)).size).toBe(body.data.items.length);
  if(storeIds.length===7) for(let i=1;i<=7;i++) expect(Number(body.data.items.find((row:{storeProductId:number})=>row.storeProductId===i*10+1).suggestedOrderQty)).toBe(7.5*i);
});

test('43 repeated and concurrent Generate Order preserves manual quantities and unique rows',async({request})=>{
 const first=await generate(request);expect(first.body.success).toBe(true);
 const milk=first.body.data.items.find((row:{storeProductId:number})=>row.storeProductId===11);
 const save=await request.put(`/api/order-sheet/${first.body.data.orderId}/draft`,{data:{items:[{orderItemId:milk.orderItemId,orderQty:'13',selected:true}]}});expect(save.status()).toBe(200);
 const results=await Promise.all([generate(request,{...baseInput,orderId:first.body.data.orderId}),generate(request,{...baseInput,orderId:first.body.data.orderId})]);
 for(const result of results){expect(result.response.status()).toBe(200);expect(Number(result.body.data.items.find((row:{storeProductId:number})=>row.storeProductId===11).orderQty)).toBe(13);}
 const rows=await sql`SELECT store_product_id,count(*)::int FROM order_items WHERE order_id=${first.body.data.orderId} GROUP BY store_product_id`;
 expect(rows).toHaveLength(2);expect(rows.every(row=>row.count===1)).toBe(true);
});

test('44 invalid manual precision is rejected without silently changing units',async({request})=>{
 const first=await generate(request);const milk=first.body.data.items[0];
 const response=await request.put(`/api/order-sheet/${first.body.data.orderId}/draft`,{data:{items:[{orderItemId:milk.orderItemId,orderQty:'1.23456',selected:true}]}});expect(response.status()).toBe(400);
 const [row]=await sql`SELECT final_order_qty FROM order_items WHERE id=${milk.orderItemId}`;expect(Number(row.final_order_qty)).toBe(Number(milk.orderQty));
});

test('45 seven-store codes, shared barcodes and each feed retrieve without cross-contamination',async({request})=>{
 const barcodes=await sql`SELECT store_id,store_product_id FROM product_barcodes WHERE barcode='5901234560001' ORDER BY store_id`;
 expect(barcodes.map(row=>[row.store_id,row.store_product_id])).toEqual([1,2,3,4,5,6,7].map(id=>[id,id*10+1]));
 for(let store=1;store<=7;store++){
  const [row]=await sql`SELECT (SELECT sum(sold_qty) FROM daily_sales WHERE store_product_id=${store*10+1} AND sales_date BETWEEN '2026-10-01' AND '2026-10-07') AS normal,(SELECT sum(rtc_qty) FROM rtc_sales WHERE store_product_id=${store*10+1} AND rtc_date BETWEEN '2026-10-01' AND '2026-10-07') AS rtc,(SELECT sum(wastage_qty) FROM wastage WHERE store_product_id=${store*10+1} AND wastage_date BETWEEN '2026-10-01' AND '2026-10-07') AS waste`;
  expect([Number(row.normal),Number(row.rtc),Number(row.waste)]).toEqual([28*store,7*store,3.5*store]);
 }
 await sql`DELETE FROM rtc_sales WHERE store_product_id IN (71,72,73)`;
 const ready=await (await request.post('/api/order-sheet/preflight',{data:{...baseInput,storeIds:[1,7]}})).json();
 const rtc=ready.data.feedCoverage.find((row:{source:string})=>row.source==='rtc');expect(rtc.availableStoreDays).toBe(7);expect(rtc.missing.every((row:{storeId:number})=>row.storeId===7)).toBe(true);
});
