import "server-only";

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { dataImportRuns as runs, stores } from "@/db/schema";

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
          return { file, size: stat.size };
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

export async function listDailyWastage(date: string) {
  if (!process.env.DAILY_WASTAGE_DOWNLOAD_DIRECTORY) {
    return { state: "disabled" as const, stores: [] };
  }
  try {
    const root = await dailyWastageArchiveRoot();
    if (!root) return { state: "unavailable" as const, stores: [] };
    const candidates = await getDb()
      .select({ storeId: stores.id, name: stores.name, source: runs.sourceFilePath })
      .from(stores)
      .leftJoin(runs, and(eq(runs.storeId, stores.id), reportsForDay(date)))
      .where(or(eq(stores.isActive, true), isNotNull(runs.id)))
      .orderBy(asc(stores.name), desc(runs.downloadedAt), desc(runs.id));

    const results = new Map<number, { storeId: number; name: string; filename: string | null }>();
    for (const candidate of candidates) {
      if (results.get(candidate.storeId)?.filename) continue;
      const original = await openPdf(root, candidate.source)
        ?? await openManualPdf(root, date, candidate.storeId);
      await original?.file.close();
      results.set(candidate.storeId, {
        storeId: candidate.storeId,
        name: candidate.name,
        filename: original ? downloadFilename(candidate.name, date) : null,
      });
    }
    return { state: "ready" as const, stores: [...results.values()] };
  } catch {
    return { state: "unavailable" as const, stores: [] };
  }
}

export async function openDailyWastage(date: string, storeId: number) {
  const root = await dailyWastageArchiveRoot();
  if (!root) return null;
  const candidates = await getDb()
    .select({ source: runs.sourceFilePath, name: stores.name })
    .from(runs)
    .innerJoin(stores, eq(runs.storeId, stores.id))
    .where(and(eq(runs.storeId, storeId), reportsForDay(date)))
    .orderBy(desc(runs.downloadedAt), desc(runs.id));

  for (const candidate of candidates) {
    const original = await openPdf(root, candidate.source);
    if (original) return { ...original, name: downloadFilename(candidate.name, date) };
  }
  const [store] = await getDb().select({ name: stores.name }).from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.isActive, true)));
  if (!store) return null;
  const original = await openManualPdf(root, date, storeId);
  return original ? { ...original, name: downloadFilename(store.name, date) } : null;
}
