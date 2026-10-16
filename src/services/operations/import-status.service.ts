import 'server-only';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
import type {ImportStatusRow} from '@/types/operations';
export async function getImportStatusRows():Promise<ImportStatusRow[]>{
    const result = await db.execute(sql`
      SELECT s.id AS store_id, s.code AS store_code, s.name AS store_name,
             source.source_type, CASE WHEN source.source_type<>'book_stock' AND last_success.imported_row_count=0 AND (actual.business_date IS NULL OR last_success.source_end_date>=actual.business_date::date) THEN last_success.source_end_date::text ELSE actual.business_date END AS latest_data_date, actual.updated_at AS latest_data_updated_at,
             r.id AS latest_run_id, r.status, r.started_at, r.completed_at, r.imported_at,
             r.imported_row_count, r.downloaded_row_count,r.downloaded_at,r.source_start_date::text,r.source_end_date::text, r.error_message, r.details->>'duplicate_of' AS duplicate_of,
             last_success.id AS last_successful_run_id,
             last_success.imported_at AS last_successful_import_at,
             last_success.imported_row_count AS last_successful_row_count
      FROM stores s
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
      LEFT JOIN LATERAL (
        SELECT max(feed.business_date)::text AS business_date, max(feed.updated_at) AS updated_at FROM (
          SELECT d.sales_date AS business_date,d.updated_at FROM daily_sales d JOIN store_products sp ON sp.id=d.store_product_id WHERE sp.store_id=s.id AND source.source_type='normal_sales'
          UNION ALL SELECT d.rtc_date,d.updated_at FROM rtc_sales d JOIN store_products sp ON sp.id=d.store_product_id WHERE sp.store_id=s.id AND source.source_type='rtc'
          UNION ALL SELECT d.wastage_date,d.updated_at FROM wastage d JOIN store_products sp ON sp.id=d.store_product_id WHERE sp.store_id=s.id AND source.source_type='wastage'
          UNION ALL SELECT d.book_stock_date,d.imported_at FROM book_stock d JOIN store_products sp ON sp.id=d.store_product_id WHERE sp.store_id=s.id AND source.source_type='book_stock'
        ) feed
      ) actual ON TRUE
      WHERE s.is_active = true
      ORDER BY s.name, source.source_type
    `);
return result as unknown as ImportStatusRow[];
}
