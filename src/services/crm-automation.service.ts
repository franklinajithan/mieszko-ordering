import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { InputError } from "@/utils/input-error";
import { crmStoreSettingsSchema, dailyImportDates, queueMovementSchema, historicalMovementSchema } from "@/validators/crm-automation";
import type { z } from "zod";
import {queueState} from "./download-queue.service";

export async function listCrmStores() {
  return db.execute(sql`SELECT s.id, s.code, s.name, s.erp_type, s.is_active,
    c.crm_url, COALESCE(c.nightly_enabled, false) AS nightly_enabled, c.updated_at
    FROM stores s LEFT JOIN store_crm_settings c ON c.store_id=s.id ORDER BY s.name`);
}

export async function getDailyImportProgress(input: z.infer<typeof historicalMovementSchema>) {
  const value = historicalMovementSchema.parse(input);
  const rows = await db.execute(sql`SELECT * FROM (
    SELECT DISTINCT ON (r.store_id,r.source_type,r.source_start_date,r.source_end_date)
      r.id, r.store_id, s.name AS store_name, r.source_type, ${queueState} AS status,
      r.source_start_date::text AS day, r.source_end_date::text AS end_date,
      r.imported_row_count, r.error_message, r.started_at, r.completed_at
    FROM data_import_runs r JOIN stores s ON s.id=r.store_id
    WHERE r.store_id IN (${sql.join(value.storeIds.map(id => sql`${id}`), sql`,`)})
      AND r.source_type IN (${sql.join(value.feeds.map(feed => sql`${feed}`), sql`,`)})
      AND r.source_start_date>=${value.startDate}::date AND r.source_end_date<=${value.endDate}::date
    ORDER BY r.store_id,r.source_type,r.source_start_date,r.source_end_date,r.id DESC
  ) latest ORDER BY day ASC,store_name,source_type,id DESC`);
  const counts: Record<string, number> = { queued: 0, downloading: 0, downloaded: 0, importing: 0, success: 0, partial: 0, failed: 0, paused: 0, cancelled: 0, resumed: 0 };
  for (const row of rows) counts[String(row.status)] = (counts[String(row.status)] ?? 0) + 1;
  // PostgreSQL bigint run IDs arrive as strings; UI actions submit numeric IDs.
  return { total: rows.length, counts, recent: rows.slice(0, 50).map(row => ({...row,id:Number(row.id)})), checkedAt: new Date().toISOString() };
}

export async function saveCrmStore(storeId: number, input: z.infer<typeof crmStoreSettingsSchema>) {
  const value = crmStoreSettingsSchema.parse(input);
  if (!Number.isSafeInteger(storeId) || storeId < 1) throw new InputError("Invalid store.");
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73501, ${storeId})`);
    const store = await tx.execute(sql`SELECT id, is_active, erp_type FROM stores WHERE id=${storeId}`);
    if (!store.length) throw new InputError("Store not found.");
    if (value.nightlyEnabled && (!store[0].is_active || store[0].erp_type !== "msp")) {
      throw new InputError("Nightly Nebula imports require an active MSP store.");
    }
    await tx.execute(sql`INSERT INTO store_crm_settings(store_id, crm_url, nightly_enabled)
      VALUES(${storeId}, ${new URL(value.crmUrl).toString()}, ${value.nightlyEnabled})
      ON CONFLICT(store_id) DO UPDATE SET crm_url=EXCLUDED.crm_url,
      nightly_enabled=EXCLUDED.nightly_enabled, updated_at=now()`);
    return { storeId };
  });
}

export async function queueDailyMovementImports(input: z.infer<typeof queueMovementSchema>) {
  const value = queueMovementSchema.parse(input);
  const days = dailyImportDates(value.startDate, value.endDate);
  // Stable lock order avoids deadlocks when two multi-store requests overlap.
  const ids = [...new Set(value.storeIds)].sort((a, b) => a - b);
  const feeds = [...new Set(value.feeds)];
  return db.transaction(async tx => {
    const runIds: number[] = [];
    const skipped: { storeId: number; feed: string; date: string; reason: string }[] = [];
    for (const storeId of ids) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(73501, ${storeId})`);
      const store = await tx.execute(sql`SELECT s.id FROM stores s JOIN store_crm_settings c ON c.store_id=s.id
        WHERE s.id=${storeId} AND s.is_active=true AND s.erp_type='msp' AND c.crm_url<>''`);
      if (!store.length) throw new InputError(`Configure a CRM URL for active MSP store ${storeId} before queueing reports.`);
      for (const day of days) for (const feed of feeds) {
        const existing = await tx.execute(sql`SELECT id, status FROM data_import_runs
          WHERE store_id=${storeId} AND source_type=${feed}
          AND source_start_date<=${day}::date AND source_end_date>=${day}::date
          AND (status IN ('queued','downloading','downloaded','importing')
            OR (${!value.replaceCompleted} AND status IN ('success','failed')))
          ORDER BY id DESC LIMIT 1`);
        if (existing.length) {
          skipped.push({ storeId, feed, date: day, reason: existing[0].status === 'failed'
            ? 'Failed attempt exists: use Retry in import monitoring, or explicitly re-download completed dates.'
            : `Existing ${existing[0].status} attempt` });
          continue;
        }
        const created = await tx.execute(sql`INSERT INTO data_import_runs
          (store_id, source_type, trigger_type, source_start_date, source_end_date, details)
          VALUES(${storeId},${feed},'manual',${day},${day},'{"requested_from_ui":true}'::jsonb) RETURNING id`);
        runIds.push(Number(created[0].id));
      }
    }
    return { queued: runIds.length, skipped, runIds, days: days.length };
  });
}
