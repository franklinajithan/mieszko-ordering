import 'server-only';
import {sql} from 'drizzle-orm';
import {db} from '@/db';
import {InputError} from '@/utils/input-error';

// Terminal audit states stop even older workers, whose atomic import checks status.
// Resume always creates another run ID, so an old downloader cannot resume writing.
export const queueState = sql`CASE WHEN r.status='failed' AND r.details->>'queue_control' IN ('paused','cancelled','resumed') THEN r.details->>'queue_control' WHEN r.status='failed' AND r.details->>'partial_import'='true' THEN 'partial' ELSE r.status END`;
export type QueueFilters={storeId?:number;feed?:string;view:string;page:number};
export async function getDownloadQueue(filters:QueueFilters){
 const scope=sql`(${filters.storeId??null}::int IS NULL OR r.store_id=${filters.storeId??null}) AND (${filters.feed??null}::text IS NULL OR r.source_type=${filters.feed??null})`;
 const view=filters.view==='processing'?sql`${queueState} IN ('downloading','downloaded','importing')`:filters.view==='completed'?sql`${queueState}='success'`:filters.view==='all'?sql`true`:sql`${queueState}=${filters.view}`;
 const [rows,totals,stores,active,next]=await Promise.all([
  db.execute(sql`SELECT r.id::int,r.store_id,s.name AS store_name,r.source_type,${queueState} AS status,r.source_start_date::text AS from_date,r.source_end_date::text AS to_date,r.started_at,r.completed_at,r.downloaded_row_count,r.imported_row_count,r.error_message,r.source_file_name,r.details->>'retry_of' AS retry_of,CASE WHEN r.details->>'automatic_retry_count' ~ '^[1-3]$' THEN (r.details->>'automatic_retry_count')::int ELSE NULL END AS automatic_retry_count
   FROM data_import_runs r LEFT JOIN stores s ON s.id=r.store_id WHERE ${scope} AND ${view} ORDER BY r.id ${filters.view==='queued'?sql`ASC`:sql`DESC`} LIMIT 50 OFFSET ${(filters.page-1)*50}`),
  db.execute(sql`SELECT ${queueState} AS status,count(*)::int AS count FROM data_import_runs r WHERE ${scope} GROUP BY 1`),
  db.execute(sql`SELECT id,name FROM stores ORDER BY name`),
  // Always show current activity across stores, even while the table is filtered.
  db.execute(sql`SELECT r.id::int,s.name AS store_name,r.source_type,r.status,r.source_start_date::text AS from_date,r.source_end_date::text AS to_date,r.started_at,r.source_file_name,r.downloaded_row_count
    FROM data_import_runs r LEFT JOIN stores s ON s.id=r.store_id WHERE r.status IN ('downloading','downloaded','importing') ORDER BY r.id LIMIT 10`),
  // Match the database-backed CRM worker's FIFO order. Book Stock is separate.
  db.execute(sql`SELECT r.id::int,s.name AS store_name,r.source_type,r.status,r.source_start_date::text AS from_date,r.source_end_date::text AS to_date
    FROM data_import_runs r JOIN stores s ON s.id=r.store_id JOIN store_crm_settings c ON c.store_id=s.id
    WHERE r.status='queued' AND s.is_active AND s.erp_type='msp' AND r.source_type IN ('normal_sales','rtc','wastage') ORDER BY r.id LIMIT 5`),
 ]);
 const counts=Object.fromEntries(totals.map(row=>[String(row.status),Number(row.count)]));
 const total=filters.view==='all'?totals.reduce((sum,row)=>sum+Number(row.count),0):filters.view==='processing'?['downloading','downloaded','importing'].reduce((sum,key)=>sum+(counts[key]??0),0):filters.view==='completed'?(counts.success??0):counts[filters.view]??0;
 return {rows,counts,stores,live:{active,next},total,page:filters.page,pageSize:50,checkedAt:new Date().toISOString()};
}
export async function controlDownload(runId:number,action:'pause'|'resume'|'cancel'|'redownload'){
 return db.transaction(async tx=>{
  // Use the same store lock as queue generation and import commits, before row locks.
  const [identity]=await tx.execute(sql`SELECT store_id FROM data_import_runs WHERE id=${runId}`);
  if(!identity?.store_id)throw new InputError('Report or store not found.');
  const storeId=Number(identity.store_id);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(73501,${storeId})`);
  const [run]=await tx.execute(sql`SELECT *,source_start_date::text AS from_date,source_end_date::text AS to_date FROM data_import_runs WHERE id=${runId} FOR UPDATE`);
  if(!run)throw new InputError('Report not found. Refresh the queue.');
  const control=(run.details as Record<string,unknown>).queue_control;
  if(action==='pause'||action==='cancel'){
   if(run.status==='importing')throw new InputError('This report is importing. Allow the atomic database import to finish, then refresh.');
   if(!['queued','downloading','downloaded'].includes(String(run.status))&&!(action==='cancel'&&control==='paused'))throw new InputError('This attempt has already finished. Refresh the queue.');
   const state=action==='pause'?'paused':'cancelled';
   await tx.execute(sql`UPDATE data_import_runs SET status='failed',completed_at=now(),error_message=${state==='paused'?'Paused by operator; resume starts a fresh download.':'Cancelled by operator; previously saved data retained.'},details=details||jsonb_build_object('queue_control',${state}::text) WHERE id=${runId}`);
   return {runId,status:state,message:`Report ${state}. A CRM download already underway may finish; this attempt cannot import data. An import already committed is retained.`};
  }
  if(action==='resume'&&control!=='paused')throw new InputError('Only paused reports can be resumed.');
  if(!['success','failed'].includes(String(run.status)))throw new InputError('Report is already queued or processing.');
  if(action==='redownload'&&control==='paused')throw new InputError('Use Resume for a paused report.');
  if(!run.from_date||!run.to_date)throw new InputError('This older report has no date range. Choose dates in CRM Downloads or refresh Book Stock manually.');
  const [store]=await tx.execute(sql`SELECT id FROM stores WHERE id=${storeId} AND is_active`);
  if(!store)throw new InputError('The store is inactive.');
  const [active]=await tx.execute(sql`SELECT id::int FROM data_import_runs WHERE store_id=${storeId} AND source_type=${run.source_type} AND status IN ('queued','downloading','downloaded','importing') AND (source_start_date IS NULL OR source_end_date IS NULL OR (source_start_date<=${run.to_date}::date AND source_end_date>=${run.from_date}::date)) ORDER BY id DESC LIMIT 1`);
  let next=Number(active?.id);
  if(!active){
   const [created]=await tx.execute(sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date,details) VALUES(${storeId},${run.source_type},'retry',${run.from_date}::date,${run.to_date}::date,jsonb_build_object('retry_of',${runId}::int,'requested_from_ui',true)) RETURNING id::int`);
   next=Number(created.id);
  }
  if(action==='resume')await tx.execute(sql`UPDATE data_import_runs SET details=details||jsonb_build_object('queue_control','resumed','resumed_as',${next}::int) WHERE id=${runId}`);
  return {runId:next,status:'queued',message:active?'An overlapping report is already queued or processing.':`Fresh download queued as job #${next}. The worker must be running with this feed enabled.`};
 });
}
