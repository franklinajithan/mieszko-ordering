import {test,expect} from '@playwright/test';
import postgres from 'postgres';import {readFileSync} from 'node:fs';
const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1,prepare:false,onnotice:()=>{}});
test.beforeEach(async()=>{await sql.unsafe(readFileSync('tests/fixtures/seven-stores.sql','utf8'));});test.afterAll(async()=>{await sql.end();});
test('API: catalogue and ordering status reads are connected to the disposable database',async({request})=>{
 for(const route of ['/api/stores','/api/suppliers','/api/products','/api/products/catalog?storeId=1','/api/departments','/api/departments/mappings','/api/orders','/api/data-operations/status','/api/order-sheet/book-stock-status?storeIds=1,7','/api/order-sheet/supplier-status?supplierIds=1,2,3','/api/order-sheet/sales-data-status?storeIds=1,7&startDate=2026-10-01&endDate=2026-10-07','/api/stores/1/book-stock/latest']){
  const response=await request.get(route);expect(response.status(),`${route}: ${await response.text()}`).toBe(200);
  expect((await response.json()).success,route).toBe(true);
 }
});
test('API: sales status rejects invalid calendar dates without a database error',async({request})=>{
 for(const startDate of ['2026-02-30','garbage']){
  const response=await request.get(`/api/order-sheet/sales-data-status?storeIds=1&startDate=${startDate}&endDate=2026-10-07`);expect(response.status()).toBe(400);
 }
});
