import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { InputError } from '@/utils/input-error';
import { historicalImportDates, historicalMovementSchema } from '@/validators/crm-automation';
import { queueState } from './download-queue.service';
import type { z } from 'zod';

type Scope = z.infer<typeof historicalMovementSchema>;
export async function getReportCoverage(input: Scope, page = 1, missingOnly = true) {
 const value = historicalMovementSchema.parse(input);
 const ids = [...new Set(value.storeIds)];
 const feeds = [...new Set(value.feeds)];
 const storeScope = sql.join(ids.map(id => sql`${id}`), sql`,`);
 const [stores, runs, saved, partial] = await Promise.all([
  db.execute(sql`SELECT s.id,s.name,(c.crm_url IS NOT NULL AND c.crm_url<>'') AS configured
   FROM stores s LEFT JOIN store_crm_settings c ON c.store_id=s.id
   WHERE s.id IN (${storeScope}) AND s.is_active AND s.erp_type='msp' ORDER BY s.name,s.id`),
  db.execute(sql`SELECT r.id::int,r.store_id,r.source_type,${queueState} AS status,
   r.source_start_date::text AS from_date,r.source_end_date::text AS to_date
   FROM data_import_runs r WHERE r.store_id IN (${storeScope})
    AND r.source_type IN (${sql.join(feeds.map(feed => sql`${feed}`), sql`,`)})
    AND r.source_start_date<=${value.endDate}::date AND r.source_end_date>=${value.startDate}::date ORDER BY r.id DESC`),
  // Existing manual rows are not proof that an entire store report is complete.
  db.execute(sql`SELECT DISTINCT sp.store_id,'normal_sales' AS source_type,d.sales_date::text AS day FROM daily_sales d JOIN store_products sp ON sp.id=d.store_product_id
    WHERE sp.store_id IN (${storeScope}) AND d.sales_date BETWEEN ${value.startDate}::date AND ${value.endDate}::date
   UNION SELECT DISTINCT sp.store_id,'rtc',d.rtc_date::text FROM rtc_sales d JOIN store_products sp ON sp.id=d.store_product_id
    WHERE sp.store_id IN (${storeScope}) AND d.rtc_date BETWEEN ${value.startDate}::date AND ${value.endDate}::date
   UNION SELECT DISTINCT sp.store_id,'wastage',d.wastage_date::text FROM wastage d JOIN store_products sp ON sp.id=d.store_product_id
    WHERE sp.store_id IN (${storeScope}) AND d.wastage_date BETWEEN ${value.startDate}::date AND ${value.endDate}::date`),
  db.execute(sql`SELECT store_id,source_type,report_date::text AS day FROM crm_partial_publications WHERE store_id IN (${storeScope}) AND report_date BETWEEN ${value.startDate}::date AND ${value.endDate}::date`),
 ]);
 const partialDays = new Set(partial.map(row => `${row.store_id}:${row.source_type}:${row.day}`));
 const savedDays = new Set(saved.map(row => `${row.store_id}:${row.source_type}:${row.day}`));
 const grouped = new Map<string, Array<(typeof runs)[number]>>();
 for (const run of runs) {
  const key = `${run.store_id}:${run.source_type}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key)!.push(run);
 }
 const rows = historicalImportDates(value.startDate,value.endDate).flatMap(day => stores.flatMap(store => feeds.map(feed => {
  const attempts = (grouped.get(`${store.id}:${feed}`) ?? []).filter(run => String(run.from_date)<=day && String(run.to_date)>=day);
  const active = attempts.find(run => ['queued','downloading','downloaded','importing'].includes(String(run.status)));
  const isPartial = partialDays.has(`${store.id}:${feed}:${day}`);
  const available = !isPartial && attempts.some(run => run.status==='success'); // Includes verified zero reports and prior data retained after a failed retry.
  const latest = active ?? attempts[0];
  const hasRows = savedDays.has(`${store.id}:${feed}:${day}`);
  const status = active ? String(active.status) : available ? 'success' : isPartial ? 'partial' : latest ? String(latest.status) : hasRows ? 'unverified' : 'missing';
  const paused = ['paused','resumed'].includes(status);
  const canDownload = !available && !active && !paused && !!store.configured;
  const reason = available ? (active ? 'Saved report available; another attempt is in progress.' : 'Complete report saved.')
   : active ? 'Waiting for download or import to finish.'
   : status==='partial' ? 'Matching products saved; unmatched products need review.'
   : paused ? 'Paused by operator. Resume from Download Queue.'
   : hasRows ? 'Saved rows exist; a complete report is not recorded for this date.'
   : `Report data is not available for ${day}.`;
  return { store_id: Number(store.id),store_name: String(store.name),source_type:feed,day,status,available,has_rows:hasRows,
   run_id:latest ? Number(latest.id) : null,can_download:canDownload,reason,
   configuration_required:!store.configured };
 })));
 const available = rows.filter(row => row.available).length;
 const pending = rows.filter(row => !row.available && ['queued','downloading','downloaded','importing'].includes(row.status)).length;
 const gaps = rows.filter(row => !row.available);
 const filtered = missingOnly ? gaps : rows;
 const pages = Math.max(1,Math.ceil(filtered.length/50));
 const currentPage = Math.min(page,pages);
 return { expected:rows.length,available,unavailable:gaps.length,pending,actionRequired:gaps.length-pending,
  percentage:rows.length ? Math.floor(100*available/rows.length) : 0,
  rows:filtered.slice((currentPage-1)*50,currentPage*50),total:filtered.length,page:currentPage,pages,checkedAt:new Date().toISOString() };
}

/** A gap button never overwrites a completed report and rechecks under the import lock. */
export async function downloadMissingReport(storeId: number, feed: Scope['feeds'][number], day: string) {
 historicalMovementSchema.parse({storeIds:[storeId],feeds:[feed],startDate:day,endDate:day});
 return db.transaction(async tx => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(73501,${storeId})`);
  const [store] = await tx.execute(sql`SELECT s.id FROM stores s JOIN store_crm_settings c ON c.store_id=s.id
   WHERE s.id=${storeId} AND s.is_active AND s.erp_type='msp' AND c.crm_url<>''`);
  if (!store) throw new InputError('Save a CRM URL for this active MSP store before downloading.');
  const attempts = await tx.execute(sql`SELECT r.id::int,${queueState} AS status FROM data_import_runs r
   WHERE r.store_id=${storeId} AND r.source_type=${feed} AND ((r.source_start_date<=${day}::date AND r.source_end_date>=${day}::date)
    OR (r.status IN ('queued','downloading','downloaded','importing') AND (r.source_start_date IS NULL OR r.source_end_date IS NULL))) ORDER BY r.id DESC`);
  if (attempts.some(row => row.status==='success')) return {message:'This date already has a completed report. Refresh coverage.',runId:null};
  const active = attempts.find(row => ['queued','downloading','downloaded','importing'].includes(String(row.status)));
  if (active) return {message:`This report is already queued or processing as job #${active.id}.`,runId:Number(active.id)};
  if (attempts[0] && ['paused','resumed'].includes(String(attempts[0].status))) throw new InputError('This report was paused. Use Resume in Download Queue.');
  const details = { requested_from_ui:true,requested_from_gap:true,...(attempts[0] ? {retry_of:Number(attempts[0].id)} : {}) };
  const [created] = await tx.execute(sql`INSERT INTO data_import_runs(store_id,source_type,trigger_type,source_start_date,source_end_date,details)
   VALUES(${storeId},${feed},${attempts[0]?'retry':'manual'},${day}::date,${day}::date,${JSON.stringify(details)}::jsonb) RETURNING id::int`);
  return {message:`Download queued for ${day} as job #${created.id}. The server worker must be running with this feed enabled.`,runId:Number(created.id)};
 });
}
