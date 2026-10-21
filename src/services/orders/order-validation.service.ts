import {reportNeedsReview} from '@/utils/operations-freshness';
import 'server-only';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
import {orderRepository} from '@/repositories';
import {settingsFromOrder} from '@/services/order-sheet.service';
import {getImportCoverage} from '@/services/import-readiness.service';
import {getImportStatusRows} from '@/services/operations/import-status.service';
import {validCaseSize} from '@/services/operations/data-quality.service';
import {InputError} from '@/utils/input-error';
import {isIsoDateString} from '@/utils/iso-date';
import {todayIso} from '@/utils/order-sheet-form';
import {parseDbDecimal} from '@/utils/decimal';
import type {OrderValidation,ValidationIssue} from '@/types/operations';
export async function validateOrderForExport(orderId:number):Promise<OrderValidation>{
 const order=await orderRepository.getById(orderId);if(!order)throw new InputError('Order not found');
 const issues:ValidationIssue[]=[];const add=(code:string,severity:ValidationIssue['severity'],message:string,action:string,href:string,itemCode?:string,storeId?:number)=>issues.push({code,severity,message,action,href,itemCode,storeId});
 if(!isIsoDateString(order.deliveryDate))add('delivery_date','blocking','A valid delivery date is required.','Correct the order dates.','/order-sheet');
 const rows=await db.execute(sql`SELECT i.*,p.name AS product_name,s.name AS store_name,su.name AS supplier_name,sp.store_id,sp.store_product_code,p.is_active AS product_active,sp.is_active AS store_product_active,s.is_active AS store_active,su.is_active AS supplier_active,m.supplier_code AS current_code,m.is_active AS mapping_active,q.net_price AS current_price
 FROM order_items i JOIN store_products sp ON sp.id=i.store_product_id JOIN products p ON p.id=sp.product_id JOIN stores s ON s.id=sp.store_id
 LEFT JOIN suppliers su ON su.id=i.cheapest_supplier_id
 LEFT JOIN supplier_products m ON m.product_id=p.id AND m.supplier_id=su.id
 LEFT JOIN LATERAL (SELECT pr.net_price FROM supplier_prices pr WHERE pr.supplier_product_id=m.id AND pr.supplier_id=su.id AND pr.supplier_code=m.supplier_code
   AND pr.effective_date<=${order.orderDate}::date AND (pr.valid_until IS NULL OR pr.valid_until>=${order.orderDate}::date)
   ORDER BY pr.effective_date DESC,pr.imported_at DESC,pr.id DESC LIMIT 1) q ON TRUE
 WHERE i.order_id=${orderId}`);
 let positive=0,zero=0;
 for(const row of rows){
  const code=String(row.store_product_code),store=Number(row.store_id),quantity=parseDbDecimal(row.final_order_qty as string);
  if(!quantity.isFinite()||quantity.isNegative()){add('invalid_quantity','blocking',`${code}: invalid or negative quantity.`,'Correct the order quantity.',`/orders/${orderId}`,code,store);continue;}
  if(quantity.isZero()){zero++;continue;}positive++;
  if(!row.product_active||!row.store_product_active||!row.store_active)add('inactive_product','blocking',`${code}: store or product is inactive.`,'Review the catalogue and recalculate.','/products',code,store);
  const quotes=row.supplier_quotes as Array<{supplierId:number;supplierProductCode:string|null;caseSize:string|null;isCheapest:boolean}>;
  const chosen=quotes?.find(q=>q.isCheapest&&q.supplierId===row.cheapest_supplier_id);
  const hasQuote=!!row.cheapest_supplier_id&&!!chosen?.supplierProductCode;
  const mappingValid=hasQuote&&!!row.mapping_active&&row.current_code===chosen!.supplierProductCode;
  if(!hasQuote)add('missing_quote','blocking',`${code}: no supplier with a valid saved unit price.`,'Review supplier codes and prices, then recalculate.','/supplier-prices',code,store);
  else if(!mappingValid)add('missing_mapping','blocking',`${code}: selected supplier mapping is missing or changed.`,'Correct the supplier code and recalculate.','/supplier-codes',code,store);
  if(row.cheapest_supplier_id&&!row.supplier_active)add('inactive_supplier','blocking',`${code}: selected supplier is inactive.`,'Choose an active supplier and recalculate.','/stores',code,store);
  const price=parseDbDecimal(row.cheapest_net_price as string|null);const current=parseDbDecimal(row.current_price as string|null);
  if(mappingValid&&(row.price_status!=='complete'||!price.isFinite()||!current.isFinite()||!price.gt(0)||!current.gt(0)||!current.eq(price)))add('invalid_price','blocking',`${code}: no matching current valid price for the saved quote.`,'Import/correct supplier prices and recalculate.','/supplier-prices',code,store);
  if(hasQuote&&!validCaseSize(chosen!.caseSize??null))add('case_size','warning',`${code}: case size needs review. Unit price still determines the supplier.`,'Verify packaging; quantities remain units.','/supplier-prices',code,store);
  if(row.quantity_overridden)add('manual_quantity','warning',`${code}: quantity was manually adjusted to ${quantity.toString()}.`,'Confirm the edited quantity before export.',`/orders/${orderId}`,code,store);
  if(row.warning&&hasQuote)add('manual_review','warning',`${code}: supplier comparison needs review.`,'Read the saved supplier price warnings.',`/orders/${orderId}`,code,store);
 }
 if(!positive)add('empty_order','blocking','No products have a positive order quantity.','Select products and enter quantities.',`/orders/${orderId}`);
 if(zero)add('excluded_zero','info',`${zero} zero-quantity lines will be excluded.`,'No action required for intentionally unselected products.',`/orders/${orderId}`);
 const settings=settingsFromOrder(order);
 const coverage=await getImportCoverage(settings);
 for(const warning of coverage.warnings)add('missing_crm','warning',warning,'Verify missing reports in import monitoring.','/operations');
 const feeds=await getImportStatusRows();const businessDate=todayIso();
 for(const feed of feeds.filter(f=>order.storeIds.includes(f.store_id)&&(f.source_type==='normal_sales'||(f.source_type==='rtc'&&order.includeRtc)||(f.source_type==='wastage'&&order.includeWastage)||(f.source_type==='book_stock'&&order.includeBookStock)))){
  if(reportNeedsReview(feed.source_type,feed.latest_data_date,businessDate))add('outdated_crm','warning',`${feed.store_name}: ${feed.source_type} latest business date is ${feed.latest_data_date??'missing'}.`,'Refresh or verify the report before ordering.','/operations',undefined,feed.store_id);
  if(feed.status==='partial')add('partial_import','warning',`${feed.store_name}: ${feed.source_type} has saved matching rows but unmatched products remain.`,'Review Unmatched Products before relying on incomplete totals.','/unmatched-products',undefined,feed.store_id);
  if(feed.status==='failed')add('failed_import','warning',`${feed.store_name}: ${feed.source_type} latest import failed.`,'Resolve the failed import or confirm the retained data.','/operations',undefined,feed.store_id);
 }
 const context=new Map(rows.map(row=>[`${row.store_id}:${row.store_product_code}`,row]));
 for(const issue of issues){
  const row=context.get(`${issue.storeId}:${issue.itemCode}`);if(!row)continue;
  issue.productName=String(row.product_name);issue.storeName=String(row.store_name);issue.supplierName=row.supplier_name?String(row.supplier_name):undefined;
  const quotes=row.supplier_quotes as Array<{supplierId:number;supplierProductCode:string|null;caseSize:string|null;isCheapest:boolean}>;
  const chosen=quotes?.find(quote=>quote.isCheapest&&quote.supplierId===row.cheapest_supplier_id);
  if(issue.code==='missing_mapping')issue.details=`Saved supplier code: ${chosen?.supplierProductCode??'none'}. Current code: ${row.current_code??'none'}. Recalculate after correcting the mapping.`;
  if(issue.code==='invalid_price')issue.details=`Saved unit price: ${row.cheapest_net_price??'none'}. Current valid unit price on ${order.orderDate}: ${row.current_price??'none'}. Prices must be positive and match the saved quote.`;
  if(issue.code==='case_size')issue.details=`Saved case size: ${chosen?.caseSize??'not supplied'}. This is packaging information; order quantities remain individual units and the supplier is chosen by net unit price.`;
  if(issue.code==='manual_review'||issue.code==='missing_quote')issue.details=String(row.warning??'Check that an active supplier code has a positive price valid on the order date, then recalculate this order.');
 }
 return {orderId,revision:order.revision,issues,blockingCount:issues.filter(i=>i.severity==='blocking').length,warningCount:issues.filter(i=>i.severity==='warning').length,canExport:!issues.some(i=>i.severity==='blocking'),checkedAt:new Date().toISOString()};
}
export async function assertOrderReadyForExport(orderId:number,acknowledgeWarnings=false){
 const validation=await validateOrderForExport(orderId);
 if(validation.blockingCount)throw new InputError(`Pre-order validation: ${validation.blockingCount} blocking issues. ${validation.issues.find(i=>i.severity==='blocking')?.message} Review validation before exporting.`);
 if(validation.warningCount&&!acknowledgeWarnings)throw new InputError(`Review and acknowledge ${validation.warningCount} pre-order warnings before exporting.`);
 return validation;
}
