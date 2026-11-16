import {shareInFlight} from '@/utils/in-flight';
import 'server-only';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
import {queueState} from '../download-queue.service';
import type {ImportStatusRow} from '@/types/operations';
export async function getImportStatusRows():Promise<ImportStatusRow[]>{
    return shareInFlight('import-status', loadImportStatusRows);
}
async function loadImportStatusRows():Promise<ImportStatusRow[]>{
    const result = await db.execute(sql`
      WITH actual_feed AS (
        SELECT sp.store_id,'normal_sales' AS source_type,max(d.sales_date)::text AS business_date,max(d.updated_at) AS updated_at
        FROM daily_sales d JOIN store_products sp ON sp.id=d.store_product_id GROUP BY sp.store_id
        UNION ALL SELECT sp.store_id,'rtc',max(d.rtc_date)::text,max(d.updated_at)
        FROM rtc_sales d JOIN store_products sp ON sp.id=d.store_product_id GROUP BY sp.store_id
        UNION ALL SELECT sp.store_id,'wastage',max(d.wastage_date)::text,max(d.updated_at)
        FROM wastage d JOIN store_products sp ON sp.id=d.store_product_id GROUP BY sp.store_id
        UNION ALL SELECT sp.store_id,'book_stock',max(d.book_stock_date)::text,max(d.imported_at)
        FROM book_stock d JOIN store_products sp ON sp.id=d.store_product_id GROUP BY sp.store_id
      )
      SELECT s.id AS store_id, s.code AS store_code, s.name AS store_name,
             source.source_type, s.erp_type, (c.crm_url IS NOT NULL AND c.crm_url<>'') AS crm_configured,
             r.details->>'review_message' AS review_message, r.details->>'unmatched_identifier_count' AS unmatched_identifier_count,
             CASE WHEN source.source_type<>'book_stock' AND last_success.imported_row_count=0 AND (actual.business_date IS NULL OR last_success.source_end_date>=actual.business_date::date) THEN last_success.source_end_date::text ELSE actual.business_date END AS latest_data_date, CASE WHEN last_success.imported_row_count=0 AND (actual.business_date IS NULL OR last_success.source_end_date>=actual.business_date::date) THEN last_success.imported_at ELSE actual.updated_at END AS latest_data_updated_at,
             (r.status='success' AND source.source_type IN ('rtc','wastage') AND r.details->>'zero_activity'='true') AS zero_activity, r.id AS latest_run_id, ${queueState} AS status, r.started_at, r.completed_at, r.imported_at,
             r.imported_row_count, r.downloaded_row_count,r.downloaded_at,r.source_start_date::text,r.source_end_date::text, r.error_message, r.details->>'duplicate_of' AS duplicate_of,
             last_success.id AS last_successful_run_id,
             last_success.imported_at AS last_successful_import_at,
             last_success.imported_row_count AS last_successful_row_count
      FROM stores s
      LEFT JOIN store_crm_settings c ON c.store_id=s.id
      CROSS JOIN (VALUES ('normal_sales'), ('rtc'), ('wastage'), ('book_stock')) AS source(source_type)
      LEFT JOIN LATERAL (
        SELECT id, status, started_at, completed_at, imported_at, imported_row_count, downloaded_row_count,downloaded_at,source_start_date,source_end_date,error_message, details
        FROM data_import_runs
        WHERE store_id = s.id AND source_type = source.source_type
        ORDER BY started_at DESC, id DESC LIMIT 1
      ) r ON TRUE
      LEFT JOIN LATERAL (
        SELECT id, imported_at, imported_row_count, source_end_date
        FROM data_import_runs
        WHERE store_id = s.id AND source_type = source.source_type
          AND status = 'success' AND NOT (details ? 'duplicate_of')
        ORDER BY imported_at DESC NULLS LAST, id DESC LIMIT 1
      ) last_success ON TRUE
      LEFT JOIN actual_feed actual ON actual.store_id=s.id AND actual.source_type=source.source_type
      WHERE s.is_active = true
      ORDER BY s.name, source.source_type
    `);
return result as unknown as ImportStatusRow[];
}
