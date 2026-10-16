import {shareInFlight} from '@/utils/in-flight';
import 'server-only';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
import {todayIso} from '@/utils/order-sheet-form';
import {getImportStatusRows} from './import-status.service';
import {getQualityIssues} from './data-quality.service';
export const officeStores=[['0365','Hounslow'],['0766','Perivale'],['0650','East Ham'],['0665','Hayes'],['0566','Gravesend'],['0602','Watford'],['0388','Streatham']] as const;
export async function getControlCentre(){
 return shareInFlight('control-centre', loadControlCentre);
}
async function loadControlCentre(){
 const day=todayIso();
 const [feeds,quality,stores,counts]=await Promise.all([getImportStatusRows(),getQualityIssues(),db.execute(sql`SELECT id,code,name,is_active FROM stores ORDER BY name`),db.execute(sql`SELECT s.id,
   (SELECT count(DISTINCT i.order_id)::int FROM order_items i JOIN store_products sp ON sp.id=i.store_product_id JOIN orders o ON o.id=i.order_id WHERE sp.store_id=s.id AND (o.calculated_at AT TIME ZONE 'Europe/London')::date=${day}::date) AS orders_today,
   (SELECT count(*)::int FROM supplier_orders so WHERE so.store_id=s.id AND (so.exported_at IS NULL OR so.source_revision<>(SELECT revision FROM orders WHERE id=so.order_id))) AS pending
 FROM stores s`)]);
 const ordered=[...officeStores.map(([code,name])=>({code,name,row:stores.find(s=>s.code===code)})),...stores.filter(s=>!officeStores.some(([code])=>code===s.code)).map(s=>({code:String(s.code),name:String(s.name),row:s}))];
 return {generatedAt:new Date().toISOString(),businessDate:day,stores:ordered.map(({code,name,row})=>{
   const id=row?Number(row.id):null;const scoped=quality.filter(q=>q.storeId===id);const c=counts.find(c=>Number(c.id)===id);
   return {id,code,name,configured:!!row,active:row?.is_active===true,feeds:feeds.filter(f=>f.store_id===id),ordersToday:Number(c?.orders_today??0),pendingSupplierOrders:Number(c?.pending??0),missingMappings:new Set(scoped.filter(q=>q.type==='missing_supplier_code').map(q=>q.productId)).size,missingPrices:new Set(scoped.filter(q=>q.type==='missing_price').map(q=>q.productId)).size,qualityIssues:scoped.length};
 })};
}
export type ControlCentre=Awaited<ReturnType<typeof getControlCentre>>;
