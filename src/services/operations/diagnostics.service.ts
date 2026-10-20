import 'server-only';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
/** Allowlisted audit metadata only: never includes commands, paths, credentials or free-form errors. */
export async function getDiagnostics(storeId?:number){
 const rows=await db.execute(sql`SELECT id::text,store_id,source_type,trigger_type,status,source_start_date::text,source_end_date::text,started_at,completed_at,downloaded_at,imported_at,downloaded_row_count,imported_row_count,rejected_row_count,
 CASE WHEN details->>'partial_import'='true' THEN 'Partial import: matching rows saved; unmatched products pending.'
 WHEN error_message ILIKE '%unmatched%' THEN 'Unmatched product identifiers; review Data Quality.'
 WHEN error_message ILIKE '%store%' THEN 'Store identity or report configuration needs review.'
 WHEN error_message ILIKE '%empty%' THEN 'Empty report; previous data retained.'
 WHEN error_message ILIKE '%timeout%' OR error_message ILIKE '%stopped%' THEN 'Worker interrupted or timed out; inspect and retry.'
 WHEN status='failed' THEN 'Import failed; inspect the source report and worker configuration.' ELSE NULL END AS error_summary,
 CASE WHEN details->>'retry_of' ~ '^[0-9]+$' THEN details->>'retry_of' ELSE NULL END AS retry_of,CASE WHEN details->>'duplicate_of' ~ '^[0-9]+$' THEN details->>'duplicate_of' ELSE NULL END AS duplicate_of,CASE WHEN details->>'automatic_retry_count' ~ '^[1-3]$' THEN (details->>'automatic_retry_count')::int ELSE NULL END AS automatic_retry_count,CASE WHEN details->>'automatic_retry_reason' IN ('download_retry','parser_upgrade') THEN details->>'automatic_retry_reason' ELSE NULL END AS automatic_retry_reason
 FROM data_import_runs WHERE (${storeId??null}::integer IS NULL OR store_id=${storeId??null}) ORDER BY id DESC LIMIT 1000`);
 return {generatedAt:new Date().toISOString(),scope:storeId??'all stores',limit:1000,notes:'Latest 1000 audit attempts. Excludes source files, paths, configuration, credentials and raw errors.',runs:rows};
}
