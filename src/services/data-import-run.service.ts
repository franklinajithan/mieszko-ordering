import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const importSourceTypes = ["normal_sales", "rtc", "wastage", "book_stock"] as const;
export type ImportSourceType = (typeof importSourceTypes)[number];
export type ImportTrigger = "nightly" | "manual" | "retry";
export type ImportStatus = "queued" | "downloading" | "downloaded" | "importing" | "success" | "failed";

type StartImport = {
  storeId: number;
  sourceType: ImportSourceType;
  triggerType: ImportTrigger;
  sourceFileName?: string;
};
type FinishImport = {
  runId: number;
  importedRowCount: number;
  rejectedRowCount?: number;
  sourceFileName?: string;
};
function positiveId(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid import identifier");
}
function nonnegativeCount(count: number) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid import row count");
}

/** Only call from trusted server-side import processes, not public browser routes. */
export async function startImportRun(input: StartImport): Promise<number> {
  positiveId(input.storeId);
  if (!importSourceTypes.includes(input.sourceType)) throw new Error("Unknown import source");
  if (!["nightly", "manual", "retry"].includes(input.triggerType)) throw new Error("Unknown import trigger");
  const result = await db.execute(sql`
    INSERT INTO data_import_runs (store_id, source_type, trigger_type, status, source_file_name)
    VALUES (${input.storeId}, ${input.sourceType}, ${input.triggerType}, 'queued', ${input.sourceFileName ?? null})
    RETURNING id
  `);
  const id = Number(result[0]?.id);
  positiveId(id);
  return id;
}

export async function markImportRunStatus(runId: number, status: "downloading" | "downloaded" | "importing"): Promise<void> {
  positiveId(runId);
  const previousStatus = status === "downloading" ? "queued" : status === "downloaded" ? "downloading" : "downloaded";
  const result = await db.execute(sql`
    UPDATE data_import_runs
    SET status = ${status},
        downloaded_at = CASE WHEN ${status} = 'downloaded' THEN now() ELSE downloaded_at END
    WHERE id = ${runId} AND status = ${previousStatus}
    RETURNING id
  `);
  if (!result.length) throw new Error("Import run not found or already finished");
}

export async function finishImportRun(input: FinishImport): Promise<void> {
  positiveId(input.runId);
  nonnegativeCount(input.importedRowCount);
  nonnegativeCount(input.rejectedRowCount ?? 0);
  const result = await db.execute(sql`
    UPDATE data_import_runs
    SET status = 'success', imported_at = now(), completed_at = now(),
        imported_row_count = ${input.importedRowCount},
        rejected_row_count = ${input.rejectedRowCount ?? 0},
        source_file_name = COALESCE(${input.sourceFileName ?? null}, source_file_name)
    WHERE id = ${input.runId} AND status = 'importing'
    RETURNING id
  `);
  if (!result.length) throw new Error("Import run must be importing before success");
}

export async function failImportRun(runId: number, reason: string): Promise<void> {
  positiveId(runId);
  await db.execute(sql`
    UPDATE data_import_runs
    SET status = 'failed', completed_at = now(), error_message = ${reason.slice(0, 2000)}
    WHERE id = ${runId} AND status NOT IN ('success', 'failed')
  `);
}

/** Reserve one manual book-stock job per store. The office worker will
 * download/import it; creating a request never marks stock as refreshed.
 * Concurrent requests are serialized by a PostgreSQL advisory lock.
 */
export async function queueBookStockRefresh(storeId: number): Promise<{ runId: number; alreadyQueued: boolean }> {
  positiveId(storeId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73501, ${storeId})`);
    const store = await tx.execute(sql`SELECT id FROM stores WHERE id = ${storeId} AND is_active = true`);
    if (!store.length) throw new Error("Active store not found");
    const existing = await tx.execute(sql`
      SELECT id FROM data_import_runs
      WHERE store_id = ${storeId} AND source_type = 'book_stock'
        AND status IN ('queued', 'downloading', 'downloaded', 'importing')
      ORDER BY id DESC LIMIT 1
    `);
    if (existing.length) {
      return { runId: Number(existing[0].id), alreadyQueued: true };
    }
    const created = await tx.execute(sql`
      INSERT INTO data_import_runs (store_id, source_type, trigger_type, status)
      VALUES (${storeId}, 'book_stock', 'manual', 'queued')
      RETURNING id
    `);
    return { runId: Number(created[0].id), alreadyQueued: false };
  });
}

/**
 * Atomically claim the oldest pending book-stock refresh for an office worker.
 * SKIP LOCKED ensures concurrent workers never process the same request.
 */
export async function claimNextBookStockRefresh(): Promise<{
  runId: number;
  storeId: number;
} | null> {
  const result = await db.execute(sql`
    UPDATE data_import_runs
    SET status = 'downloading', started_at = now()
    WHERE id = (
      SELECT id FROM data_import_runs
      WHERE source_type = 'book_stock' AND status = 'queued'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, store_id
  `);
  const row = result[0];
  if (!row) return null;
  return { runId: Number(row.id), storeId: Number(row.store_id) };
}

/** Identify abandoned work after an office PC crash or interrupted downloader.
 * Requeue only with a deliberate retry operation; never mark it successful.
 */
export async function failStalledImportRuns(olderThanMinutes = 120): Promise<number> {
  if (!Number.isSafeInteger(olderThanMinutes) || olderThanMinutes < 15 || olderThanMinutes > 1440) {
    throw new Error("Invalid stalled import timeout");
  }
  const result = await db.execute(sql`
    UPDATE data_import_runs
    SET status = 'failed', completed_at = now(),
        error_message = 'Import worker stopped or timed out before completion'
    WHERE status IN ('downloading', 'downloaded', 'importing')
      AND started_at < now() - (${olderThanMinutes} * interval '1 minute')
    RETURNING id
  `);
  return result.length;
}
