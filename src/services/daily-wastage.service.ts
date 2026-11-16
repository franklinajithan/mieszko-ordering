import "server-only";

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { dataImportRuns as runs, stores } from "@/db/schema";

import { todayIso } from "@/utils/order-sheet-form";

export const dailyWastageDate = z.iso.date();

function downloadFilename(store: string, date: string) {
  const name = store.normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
  return `Wastage_${name || "Store"}_${date}.pdf`;
}

export async function dailyWastageArchiveRoot() {
  const configured = process.env.DAILY_WASTAGE_DOWNLOAD_DIRECTORY;
  return configured && path.isAbsolute(configured) ? realpath(configured) : null;
}

function reportsForDay(date: string) {
  return and(
    eq(runs.sourceType, "wastage"),
    eq(runs.sourceStartDate, date),
    eq(runs.sourceEndDate, date),
    isNotNull(runs.downloadedAt),
    isNotNull(runs.sourceFilePath),
    or(eq(runs.status, "success"), sql`${runs.details}->>'source_sha256' IS NOT NULL`),
  );
}

async function openPdf(root: string, source: string | null) {
  if (!source || !path.isAbsolute(source)) return null;
  const relative = path.relative(root, source);
  if (!/^\d+[\\/]report\.(xls|xlsx|csv)$/.test(relative)) return null;
  return openPdfFile(path.join(root, path.dirname(relative), "report.pdf"));
}

async function openManualPdf(root: string, date: string, storeId: number) {
  return openPdfFile(path.join(root, ".manual-pdfs", date, String(storeId), "report.pdf"));
}

async function openPdfFile(filePath: string) {
  try {
    if (await realpath(filePath) !== filePath) return null;
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (stat.isFile() && stat.size >= 5) {
        const signature = Buffer.alloc(5);
        const { bytesRead } = await file.read(signature, 0, signature.length, 0);
        if (bytesRead === signature.length && signature.toString("ascii") === "%PDF-") {
          return { file, size: stat.size, savedAt: stat.mtime };
        }
      }
    } catch (error) {
      await file.close();
      throw error;
    }
    await file.close();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "ELOOP") throw error;
  }
  return null;
}

// Completed-day archive PDFs take priority. Before one exists, serve the latest snapshot.
async function openStorePdf(root: string, date: string, storeId: number, sources: (string | null)[]) {
  let best: (NonNullable<Awaited<ReturnType<typeof openPdfFile>>> & { final: boolean }) | null = null;
  try {
    const manual = await openManualPdf(root, date, storeId);
    if (manual) best = { ...manual, final: false };

    for (const source of new Set(sources)) {
      const archived = await openPdf(root, source);
      if (!archived) continue;
      const final = todayIso(archived.savedAt) > date;
      if (!best || (final && !best.final) || (final === best.final && archived.savedAt > best.savedAt)) {
        const previous = best;
        best = { ...archived, final };
        await previous?.file.close();
      } else {
        await archived.file.close();
      }
    }
    return best;
  } catch (error) {
    await best?.file.close();
    throw error;
  }
}

function storeReports(date: string, storeId?: number) {
  return getDb()
    .select({ storeId: stores.id, name: stores.name, source: runs.sourceFilePath })
    .from(stores)
    .leftJoin(runs, and(eq(runs.storeId, stores.id), reportsForDay(date)))
    .where(and(or(eq(stores.isActive, true), isNotNull(runs.id)),
      storeId === undefined ? undefined : eq(stores.id, storeId)))
    .orderBy(asc(stores.name), desc(runs.downloadedAt), desc(runs.id));
}

export async function listDailyWastage(date: string) {
  if (!process.env.DAILY_WASTAGE_DOWNLOAD_DIRECTORY) {
    return { state: "disabled" as const, stores: [] };
  }
  try {
    const root = await dailyWastageArchiveRoot();
    if (!root) return { state: "unavailable" as const, stores: [] };
    const candidates = await storeReports(date);
    const grouped = new Map<number, { name: string; sources: (string | null)[] }>();
    for (const candidate of candidates) {
      const store = grouped.get(candidate.storeId);
      if (store) store.sources.push(candidate.source);
      else grouped.set(candidate.storeId, { name: candidate.name, sources: [candidate.source] });
    }

    const results = [];
    for (const [storeId, { name, sources }] of grouped) {
      const report = await openStorePdf(root, date, storeId, sources);
      await report?.file.close();
      results.push({
        storeId,
        name,
        filename: report ? downloadFilename(name, date) : null,
        final: report?.final ?? false,
      });
    }
    return { state: "ready" as const, stores: results };
  } catch {
    return { state: "unavailable" as const, stores: [] };
  }
}

export async function openDailyWastage(date: string, storeId: number) {
  const root = await dailyWastageArchiveRoot();
  if (!root) return null;
  const candidates = await storeReports(date, storeId);
  if (!candidates.length) return null;
  const report = await openStorePdf(root, date, storeId, candidates.map(candidate => candidate.source));
  return report ? { ...report, name: downloadFilename(candidates[0].name, date) } : null;
}
