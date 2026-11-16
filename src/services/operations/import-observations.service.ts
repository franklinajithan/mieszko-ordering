import 'server-only';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
/** Persist identifiers only; never creates products, barcodes or prices. */
export async function recordUnmatchedIdentifiers(storeId:number,source:string,type:'unknown_product_code'|'unmatched_barcode',references:string[]){
 const codes=[...new Set(references.map(v=>v.trim()).filter(Boolean))];
 for(let offset=0;offset<codes.length;offset+=250){
  const batch=codes.slice(offset,offset+250);
  await db.execute(sql`INSERT INTO import_quality_observations(store_id,source_type,problem_type,reference)
   VALUES ${sql.join(batch.map(code=>sql`(${storeId},${source},${type},${code})`),sql`, `)}
   ON CONFLICT(store_id,source_type,problem_type,reference) DO UPDATE SET last_seen_at=now()`);
 }
}
