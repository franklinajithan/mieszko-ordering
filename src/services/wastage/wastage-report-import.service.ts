import 'server-only';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '@/db';
import {parseWastageFileBuffer} from '@/parsers/wastage/wastage-file-parser';
import {prepareWastageImport} from './wastage-import-prepare';
import {InputError} from '@/utils/input-error';
import {isIsoDateString} from '@/utils/iso-date';
import {detectWastageFileErpType,resolveStoreErpType,validateErpFileMatch} from '@/utils/erp-file-validation';
import {toDecimal} from '@/utils/decimal';

// Byte-compatible with worker.row_fingerprint, so the worker can verify and replay
// manual stages and protect manual edits to partially published quantities.
export function wastageFingerprint(rows: Array<[string|number,string,string]>) {
  return createHash('sha256').update(JSON.stringify(rows.sort((a,b)=>a[0]===b[0]?a[1].localeCompare(b[1]):a[0]<b[0]?-1:1)
    .map(([id,day,qty])=>[id,day,toDecimal(qty).toFixed()])).replace(/[\u007f-\uffff]/g,char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"))).digest('hex');
}

export async function validateWastageReport(input:{buffer:Buffer;fileName:string;storeId:number;date?:string}) {
  const stores=await db.execute(sql`SELECT id,name,code,erp_type FROM stores`);
  const store=stores.find(row=>Number(row.id)===input.storeId);
  if(!store)throw new InputError('Store not found');
  const parsed=await parseWastageFileBuffer(input.buffer,input.fileName,store.erp_type==='glopos'?'glopos':'msp',{
    date:input.date,storeCode:String(store.code),storeName:String(store.name),storeNames:stores.map(row=>String(row.name)),
  });
  const mismatch=validateErpFileMatch(detectWastageFileErpType(parsed.headers,input.fileName),resolveStoreErpType(String(store.erp_type)));
  if(mismatch)throw new InputError(mismatch);
  return parsed;
}

export async function importWastageReport(input:{buffer:Buffer;fileName:string;storeId:number;date:string;referenceColumn?:string;quantityColumn?:string;mappingType?:string}) {
  if(!isIsoDateString(input.date))throw new InputError('Select a valid wastage date');
  const parsed=await validateWastageReport(input);
  const referenceColumn=parsed.referenceColumn??input.referenceColumn;
  const quantityColumn=parsed.quantityColumn??input.quantityColumn;
  if(!referenceColumn||!quantityColumn)throw new InputError('Wastage report columns not detected');
  const dateColumn=parsed.headers.find(header=>/^(?:wastage\s*)?date$/i.test(header));
  if(dateColumn&&parsed.rows.some(row=>row[dateColumn]&&row[dateColumn]!==input.date))throw new InputError('Report row date differs from requested date');
  const prepared=prepareWastageImport({rows:parsed.rows,referenceColumn,quantityColumn});
  if(prepared.result.invalidRows)throw new InputError('Wastage report contains invalid rows; previous data retained');
  if(!prepared.rows.length&&!parsed.emptyReport&&!parsed.skippedExcludedReasonRows)throw new InputError('Unrecognized empty Wastage report');
  for(const row of prepared.rows){row.qty=row.qty.abs();if(row.qty.decimalPlaces()>4)throw new InputError('Quantities must have at most four decimal places');}
  const mapping=parsed.barcodeMapped||(!parsed.storeProductCodeMapped&&input.mappingType==='barcode')?'barcode':'store_product_code';
  const sourceHash=createHash('sha256').update(input.buffer).digest('hex');
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73501,${input.storeId})`);
    const [run]=await tx.execute(sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,status,source_start_date,source_end_date,source_file_name)
      VALUES(${input.storeId},'wastage','manual','importing',${input.date}::date,${input.date}::date,${input.fileName}) RETURNING id::int`);
    const products=await tx.execute(mapping==='barcode'?sql`SELECT barcode AS code,store_product_id AS id FROM product_barcodes WHERE store_id=${input.storeId}`:
      sql`SELECT identifier AS code,store_product_id AS id FROM crm_product_code_aliases WHERE store_id=${input.storeId} UNION ALL SELECT store_product_code,id FROM store_products WHERE store_id=${input.storeId}`);
    const byCode=new Map(products.map(row=>[String(row.code),Number(row.id)]));
    const unknown=prepared.rows.filter(row=>!byCode.has(row.reference));
    const resolved=new Map<number,ReturnType<typeof toDecimal>>();
    for(const row of prepared.rows){const id=byCode.get(row.reference);if(id)resolved.set(id,(resolved.get(id)??toDecimal(0)).plus(row.qty));}
    const staged=prepared.rows.map(row=>[row.reference,input.date,row.qty.toFixed()] as [string,string,string]);
    const published=[...resolved].map(([id,qty])=>[id,input.date,qty.toFixed()] as [number,string,string]);
    const details:Record<string,unknown>={source_sha256:sourceHash,zero_activity:!prepared.rows.length,activity:!prepared.rows.length?'Zero wastage':undefined};
    let saved=0,protectedDay=false;
    if(unknown.length){
      // Stage the complete normalized report, not just rejected rows.
      for(let offset=0;offset<staged.length;offset+=1000){const batch=staged.slice(offset,offset+1000);
        await tx.execute(sql`INSERT INTO crm_report_stage(run_id,identifier,report_date,quantity,mapping_type) VALUES ${sql.join(batch.map(([code,day,qty])=>sql`(${run.id},${code},${day}::date,${qty},${mapping})`),sql`,`)}`);}
      Object.assign(details,{staged_data_sha256:wastageFingerprint(staged),staged_row_count:staged.length,staged_mapping_type:mapping,
        has_unmatched_products:true,partial_import_version:1,unmatched_identifier_count:unknown.length,
        [mapping==='barcode'?'unmatched_barcodes':'unknown_product_codes']:unknown.map(row=>row.reference),
        unmatched_product_descriptions:Object.fromEntries(unknown.filter(row=>row.productName).map(row=>[row.reference,row.productName]))});
      const current=await tx.execute(sql`SELECT w.store_product_id AS id,w.wastage_qty::text AS qty FROM wastage w JOIN store_products p ON p.id=w.store_product_id WHERE p.store_id=${input.storeId} AND w.wastage_date=${input.date}::date`);
      const [owner]=await tx.execute(sql`SELECT data_sha256 FROM crm_partial_publications WHERE store_id=${input.storeId} AND source_type='wastage' AND report_date=${input.date}::date FOR UPDATE`);
      const complete=await tx.execute(sql`SELECT id FROM data_import_runs WHERE store_id=${input.storeId} AND source_type='wastage' AND status='success' AND COALESCE(details->>'has_unmatched_products','false')<>'true' AND source_start_date<=${input.date}::date AND source_end_date>=${input.date}::date LIMIT 1`);
      protectedDay=!!complete.length||!!current.length&&(!owner||owner.data_sha256!==wastageFingerprint(current.map(row=>[Number(row.id),input.date,String(row.qty)])));
      const kind=mapping==='barcode'?'Barcode':'Product code';
      for(const row of unknown){
        const [item]=await tx.execute(sql`INSERT INTO crm_product_identifiers(store_id,kind,identifier) VALUES(${input.storeId},${kind},${row.reference}) ON CONFLICT(store_id,kind,identifier) DO UPDATE SET last_checked_at=now() RETURNING id`);
        await tx.execute(sql`INSERT INTO crm_identifier_occurrences(identifier_id,run_id) VALUES(${item.id},${run.id}) ON CONFLICT DO NOTHING`);
      }
    }
    if(!protectedDay&&(!unknown.length||published.length)){
      await tx.execute(sql`DELETE FROM wastage WHERE wastage_date=${input.date}::date AND store_product_id IN(SELECT id FROM store_products WHERE store_id=${input.storeId})`);
      for(const [id,,qty] of published)await tx.execute(sql`INSERT INTO wastage(store_product_id,wastage_date,wastage_qty) VALUES(${id},${input.date}::date,${qty})`);
      saved=published.length;
      if(unknown.length)await tx.execute(sql`INSERT INTO crm_partial_publications(store_id,source_type,report_date,run_id,data_sha256,published_row_count) VALUES(${input.storeId},'wastage',${input.date}::date,${run.id},${wastageFingerprint(published)},${saved}) ON CONFLICT(store_id,source_type,report_date) DO UPDATE SET run_id=EXCLUDED.run_id,data_sha256=EXCLUDED.data_sha256,published_row_count=EXCLUDED.published_row_count,updated_at=now()`);
      else await tx.execute(sql`DELETE FROM crm_partial_publications WHERE store_id=${input.storeId} AND source_type='wastage' AND report_date=${input.date}::date`);
    }
    const message=unknown.length?'Imported — unmatched products awaiting review'+(protectedDay?'. Earlier complete or manually edited data retained; matching rows staged.':''):!prepared.rows.length?'Zero wastage':'Imported';
    Object.assign(details,{data_sha256:wastageFingerprint(published),partial_import:unknown.length>0&&saved>0,partial_published_dates:unknown.length&&saved?[input.date]:[],protected_complete_dates:protectedDay?[input.date]:[],review_message:message});
    await tx.execute(sql`UPDATE data_import_runs SET status='success',completed_at=now(),imported_at=now(),downloaded_row_count=${staged.length},imported_row_count=${saved},rejected_row_count=${unknown.length},details=${JSON.stringify(details)}::jsonb WHERE id=${run.id}`);
    return {...prepared.result,matchedRows:saved,unmatchedRows:unknown.length,message,zeroActivity:!prepared.rows.length,runId:Number(run.id)};
  });
}
