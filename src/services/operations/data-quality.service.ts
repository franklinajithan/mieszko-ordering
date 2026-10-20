import {shareInFlight} from '@/utils/in-flight';
import 'server-only';
import {sql} from 'drizzle-orm';
import {db} from '@/db';
import {todayIso} from '@/utils/order-sheet-form';
import type {QualityFilters,QualityIssue} from '@/types/operations';
export function validCaseSize(value:string|null):boolean {
  if (!value?.trim()) return false;
  return value.trim().split(/\s*[x×*]\s*/i).every(part=>/^\d+(?:\.\d+)?\s*(?:kg|g|ml|l|pcs|pc|units?)?$/i.test(part)&&Number.parseFloat(part)>0);
}
/** Read-only findings; possible duplicates are never merged or assigned invented prices. */
export async function getQualityIssues(filters:QualityFilters={},day=todayIso()):Promise<QualityIssue[]> {
 return shareInFlight(`quality:${day}:${filters.storeId??'all'}:${filters.supplierId??'all'}:${filters.type??'all'}`, () => loadQualityIssues(filters,day));
}
async function loadQualityIssues(filters:QualityFilters,day:string):Promise<QualityIssue[]> {
 const rows=await db.execute(sql`
 WITH normalized_products AS MATERIALIZED (
   SELECT id,lower(regexp_replace(trim(name),'\\s+',' ','g')) AS normalized_name FROM products WHERE is_active
 ), duplicate_names AS (
   SELECT normalized_name FROM normalized_products GROUP BY normalized_name HAVING count(*)>1
 ), duplicate_products AS (
   SELECT p.id FROM normalized_products p JOIN duplicate_names d USING(normalized_name)
 ), current_prices AS MATERIALIZED (
   SELECT DISTINCT ON (supplier_product_id,supplier_id,supplier_code)
     supplier_product_id,supplier_id,supplier_code,net_price,case_size
   FROM supplier_prices WHERE effective_date<=${day}::date
     AND (valid_until IS NULL OR valid_until>=${day}::date)
     AND (${filters.supplierId??null}::integer IS NULL OR supplier_id=${filters.supplierId??null})
   ORDER BY supplier_product_id,supplier_id,supplier_code,effective_date DESC,imported_at DESC,id DESC
 ), snapshot_dates AS MATERIALIZED (
   SELECT sp.store_id,max(b.imported_at) AS imported_at FROM book_stock b JOIN store_products sp ON sp.id=b.store_product_id
   WHERE (${filters.storeId??null}::integer IS NULL OR sp.store_id=${filters.storeId??null}) GROUP BY sp.store_id
 ), catalogue AS (
   SELECT sp.id AS spid,sp.store_id,s.name AS store_name,sp.store_product_code AS item_code,p.id AS product_id,p.name AS product_name
   FROM store_products sp JOIN stores s ON s.id=sp.store_id JOIN products p ON p.id=sp.product_id
   WHERE sp.is_active AND p.is_active AND s.is_active AND (${filters.storeId??null}::integer IS NULL OR s.id=${filters.storeId??null})
 ), offers AS (
   SELECT c.*,su.id AS supplier_id,su.name AS supplier_name,m.id AS mapping_id,m.supplier_code,m.is_active AS mapping_active,q.net_price,q.case_size
   FROM catalogue c CROSS JOIN suppliers su
   LEFT JOIN supplier_products m ON m.product_id=c.product_id AND m.supplier_id=su.id
   LEFT JOIN current_prices q ON q.supplier_product_id=m.id AND q.supplier_id=su.id AND q.supplier_code=m.supplier_code
   WHERE su.is_active AND (${filters.supplierId??null}::integer IS NULL OR su.id=${filters.supplierId??null})
 ), latest_stock AS (
   SELECT c.*,b.book_stock_qty,b.book_stock_date FROM catalogue c JOIN book_stock b ON b.store_product_id=c.spid
   JOIN snapshot_dates snapshot ON snapshot.store_id=c.store_id AND snapshot.imported_at=b.imported_at
 ), findings AS (
 SELECT 'duplicate_product' AS type,c.store_id,c.store_name,NULL::integer AS supplier_id,NULL::text AS supplier_name,c.product_id,c.item_code,c.product_name,
   'Possible duplicate name; review identities without automatically merging.'::text AS detail,NULL::text AS case_size
 FROM catalogue c WHERE EXISTS(SELECT 1 FROM duplicate_products d WHERE d.id=c.product_id)
 UNION ALL SELECT 'missing_supplier_code',store_id,store_name,supplier_id,supplier_name,product_id,item_code,product_name,'No active supplier product code is mapped.',NULL FROM offers WHERE mapping_id IS NULL OR (mapping_active AND trim(supplier_code)='')
 UNION ALL SELECT 'missing_price',store_id,store_name,supplier_id,supplier_name,product_id,item_code,product_name,'No positive current unit price for this supplier code.',NULL FROM offers WHERE mapping_active AND trim(supplier_code)<>'' AND (net_price IS NULL OR net_price<=0 OR net_price::text IN ('NaN','Infinity','-Infinity'))
 UNION ALL SELECT 'invalid_case_size',store_id,store_name,supplier_id,supplier_name,product_id,item_code,product_name,'Case size needs review; unit-price selection is unchanged.',case_size FROM offers WHERE mapping_active AND net_price>0
 UNION ALL SELECT 'negative_stock',store_id,store_name,NULL,NULL,product_id,item_code,product_name,'Latest snapshot contains negative stock: '||book_stock_qty::text,NULL FROM latest_stock WHERE book_stock_qty<0
 UNION ALL SELECT 'inconsistent_import',store_id,store_name,NULL,NULL,product_id,item_code,product_name,'Stock business date is in the future: '||book_stock_date::text,NULL FROM latest_stock WHERE book_stock_date>${day}::date
 UNION ALL SELECT 'no_recent_sales',c.store_id,c.store_name,NULL,NULL,c.product_id,c.item_code,c.product_name,'No Normal Sales history recorded in the last 28 days; confirm activity or missing reports.',NULL FROM catalogue c WHERE NOT EXISTS(SELECT 1 FROM daily_sales d WHERE d.store_product_id=c.spid AND d.sales_date BETWEEN ${day}::date-27 AND ${day}::date)
 UNION ALL SELECT 'inconsistent_import',c.store_id,c.store_name,NULL,NULL,c.product_id,c.item_code,c.product_name,'Barcode store does not match its store-product record.',NULL FROM catalogue c JOIN product_barcodes b ON b.store_product_id=c.spid WHERE b.store_id<>c.store_id
 ) SELECT *,type||':'||store_id||':'||coalesce(supplier_id::text,'all')||':'||coalesce(product_id::text,'all')||':'||coalesce(item_code,'all') AS issue_id FROM findings
 `);
 const actions:Record<string,[string,string]>={duplicate_product:['Review product identities and barcodes.','/products'],missing_supplier_code:['Map the supplier code or mark the product unavailable from this supplier.','/supplier-codes'],missing_price:['Import a valid dated supplier price; do not estimate a price.','/supplier-prices'],invalid_case_size:['Verify packaging with the supplier price file.','/supplier-prices'],negative_stock:['Check the physical balance and refresh Book Stock manually.','/book-stock'],no_recent_sales:['Check the sales report and confirm zero activity.','/daily-sales'],inconsistent_import:['Inspect the source report and its store/date mapping.','/book-stock']};
 const issues:QualityIssue[]=rows.filter(row=>row.type!=='invalid_case_size'||!validCaseSize(row.case_size as string|null)).map(row=>({id:String(row.issue_id),type:row.type as QualityIssue['type'],severity:row.type==='missing_price'||row.type==='missing_supplier_code'||row.type==='inconsistent_import'?'error':'warning',storeId:Number(row.store_id),storeName:String(row.store_name),supplierId:row.supplier_id==null?null:Number(row.supplier_id),supplierName:row.supplier_name as string|null,productId:row.product_id==null?null:Number(row.product_id),itemCode:row.item_code as string|null,productName:row.product_name as string|null,message:String(row.detail),action:actions[String(row.type)][0],href:actions[String(row.type)][1]}));
 const feeds=[['normal_sales','daily_sales','sales_date','Normal Sales'],['rtc','rtc_sales','rtc_date','RTC Sales'],['wastage','wastage','wastage_date','Wastage']] as const;
 for(const [source,table,date,label] of feeds){
  const missing=await db.execute(sql`SELECT s.id,s.name,d.day::date::text AS day FROM stores s CROSS JOIN generate_series(${day}::date-7,${day}::date-1,interval '1 day') d(day)
   WHERE s.is_active AND (${filters.storeId??null}::integer IS NULL OR s.id=${filters.storeId??null})
    AND NOT EXISTS(SELECT 1 FROM ${sql.identifier(table)} f JOIN store_products sp ON sp.id=f.store_product_id WHERE sp.store_id=s.id AND f.${sql.identifier(date)}=d.day::date)
    AND NOT EXISTS(SELECT 1 FROM data_import_runs r WHERE r.store_id=s.id AND r.source_type=${source} AND r.status='success' AND d.day::date BETWEEN r.source_start_date AND r.source_end_date)`);
  for(const row of missing) issues.push({id:`date:${source}:${row.id}:${row.day}`,type:'missing_sales_date',severity:'warning',storeId:Number(row.id),storeName:String(row.name),supplierId:null,supplierName:null,productId:null,itemCode:null,productName:null,message:`${label}: no report/activity for ${row.day}.`,action:'Verify the daily report; a successful zero-row report also confirms coverage.',href:source==='normal_sales'?'/daily-sales':source==='rtc'?'/rtc':'/wastage'});
  const inconsistent=await db.execute(sql`SELECT r.id::text,r.store_id,s.name FROM (SELECT DISTINCT ON (store_id) * FROM data_import_runs
    WHERE source_type=${source} AND status='success' AND NOT(details ? 'duplicate_of') ORDER BY store_id,imported_at DESC NULLS LAST,id DESC) r JOIN stores s ON s.id=r.store_id
    WHERE r.imported_row_count>0 AND (${filters.storeId??null}::integer IS NULL OR r.store_id=${filters.storeId??null})
    AND NOT EXISTS(SELECT 1 FROM ${sql.identifier(table)} f JOIN store_products sp ON sp.id=f.store_product_id WHERE sp.store_id=r.store_id AND f.${sql.identifier(date)} BETWEEN r.source_start_date AND r.source_end_date)`);
  for(const row of inconsistent)issues.push({id:`audit:${source}:${row.id}`,type:'inconsistent_import',severity:'error',storeId:Number(row.store_id),storeName:String(row.name),supplierId:null,supplierName:null,productId:null,itemCode:null,productName:null,message:`${label} audit #${row.id} reports imported rows but none remain in its date range.`,action:'Verify corrections and import totals before using the data.',href:'/operations'});

 }
 const failures=await db.execute(sql`SELECT r.id::text,r.store_id,s.name,r.source_type,r.details FROM data_import_runs r LEFT JOIN stores s ON s.id=r.store_id
   WHERE r.status='failed' AND NOT(r.details ? 'queue_control') AND (${filters.storeId??null}::integer IS NULL OR r.store_id=${filters.storeId??null})
   AND NOT EXISTS(SELECT 1 FROM data_import_runs ok WHERE ok.status='success' AND ok.details->>'retry_of'=r.id::text) ORDER BY r.id DESC`);
 const [knownCodes,knownBarcodes]=failures.length?await Promise.all([db.execute(sql`SELECT store_id,store_product_code AS code FROM store_products UNION SELECT store_id,identifier AS code FROM crm_product_code_aliases`),db.execute(sql`SELECT store_id,barcode AS code FROM product_barcodes`)]):[[],[]];
 const identifiers={unknown_product_code:new Set(knownCodes.map(r=>`${r.store_id}:${r.code}`)),unmatched_barcode:new Set(knownBarcodes.map(r=>`${r.store_id}:${r.code}`))};
 for(const row of failures){
  const details=row.details as Record<string,unknown>;
  for(const [key,type] of [['unknown_product_codes','unknown_product_code'],['unmatched_barcodes','unmatched_barcode']] as const){
   if(!Array.isArray(details[key]))continue;
   for(const code of details[key] as string[]){
    if(identifiers[type].has(`${row.store_id}:${String(code)}`))continue;
    issues.push({id:`${row.id}:${type}:${code}`,type,severity:'error',storeId:row.store_id==null?null:Number(row.store_id),storeName:String(row.name??'Unassigned store'),supplierId:null,supplierName:null,productId:null,itemCode:String(code),productName:null,message:`Unmatched identifier in ${row.source_type} attempt #${row.id}.`,action:'Verify the source code/barcode and map it to the correct store product, then retry.',href:'/products'});
   }
  }
  issues.push({id:`failed:${row.id}`,type:'import_failure',severity:'error',storeId:row.store_id==null?null:Number(row.store_id),storeName:String(row.name??'Unassigned store'),supplierId:null,supplierName:null,productId:null,itemCode:null,productName:null,message:`${row.source_type} import #${row.id} failed.`,action:'Review import monitoring, resolve the source error and retry.',href:'/operations'});
 }
 const observed=await db.execute(sql`SELECT o.*,s.name FROM import_quality_observations o JOIN stores s ON s.id=o.store_id
   WHERE (${filters.storeId??null}::integer IS NULL OR o.store_id=${filters.storeId??null})
   AND NOT (o.problem_type='unknown_product_code' AND EXISTS(SELECT 1 FROM store_products sp WHERE sp.store_id=o.store_id AND sp.store_product_code=o.reference))
   AND NOT (o.problem_type='unknown_product_code' AND EXISTS(SELECT 1 FROM crm_product_code_aliases a WHERE a.store_id=o.store_id AND a.identifier=o.reference))
   AND NOT (o.problem_type='unmatched_barcode' AND EXISTS(SELECT 1 FROM product_barcodes b WHERE b.store_id=o.store_id AND b.barcode=o.reference))`);
 for(const row of observed)issues.push({id:`observation:${row.id}`,type:row.problem_type as QualityIssue['type'],severity:'error',storeId:Number(row.store_id),storeName:String(row.name),supplierId:null,supplierName:null,productId:null,itemCode:String(row.reference),productName:null,message:`Unmatched identifier observed in ${row.source_type} upload or preview.`,action:'Review the source identifier and map the correct store product. Existing identities remain unchanged.',href:'/products'});
 return issues.filter(issue=>(!filters.type||issue.type===filters.type)&&(!filters.supplierId||issue.supplierId===filters.supplierId)).sort((a,b)=>a.storeName.localeCompare(b.storeName)||a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
}
