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
  const id = Number(result.rows[0]?.id);
  positiveId(id);
  return id;
}

export async function markImportRunStatus(runId: number, status: "downloading" | "downloaded" | "importing"): Promise<void> {
  positiveId(runId);
  const result = await db.execute(sql`
    UPDATE data_import_runs
    SET status = ${status},
        downloaded_at = CASE WHEN ${status} = 'downloaded' THEN now() ELSE downloaded_at END
    WHERE id = ${runId} AND status NOT IN ('success', 'failed')
    RETURNING id
  `);
  if (!result.rows.length) throw new Error("Import run not found or already finished");
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
  if (!result.rows.length) throw new Error("Import run must be importing before success");
}

export async function failImportRun(runId: number, reason: string): Promise<void> {
  positiveId(runId);
  await db.execute(sql`
    UPDATE data_import_runs
    SET status = 'failed', completed_at = now(), error_message = ${reason.slice(0, 2000)}
    WHERE id = ${runId} AND status NOT IN ('success', 'failed')
  `);
}
