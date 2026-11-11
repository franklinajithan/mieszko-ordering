import "server-only";

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { dataImportRuns as runs, stores } from "@/db/schema";

export const dailyWastageDate = z.iso.date();

const contentTypes = {
  "report.xls": "application/vnd.ms-excel",
  "report.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "report.csv": "text/csv",
};

function downloadFilename(store: string, date: string, extension: string) {
  const name = store.normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9-]+/g, "_").replace(/^_+|_+$/g, "");
  return `Wastage_${name || "Store"}_${date}${extension}`;
}

async function archiveRoot() {
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

async function openOriginal(root: string, source: string | null) {
  if (!source || !path.isAbsolute(source)) return null;
  const relative = path.relative(root, source);
  if (!/^\d+[\\/]report\.(xls|xlsx|csv)$/.test(relative)) return null;
  const filePath = path.join(root, relative);
  try {
    if (await realpath(filePath) !== filePath) return null;
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (stat.isFile() && stat.size > 0) {
        const name = path.basename(filePath) as keyof typeof contentTypes;
        return { file, size: stat.size, extension: path.extname(name), contentType: contentTypes[name] };
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
    const root = await archiveRoot();
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
      const original = await openOriginal(root, candidate.source);
      await original?.file.close();
      results.set(candidate.storeId, {
        storeId: candidate.storeId,
        name: candidate.name,
        filename: original ? downloadFilename(candidate.name, date, original.extension) : null,
      });
    }
    return { state: "ready" as const, stores: [...results.values()] };
  } catch {
    return { state: "unavailable" as const, stores: [] };
  }
}

export async function openDailyWastage(date: string, storeId: number) {
  const root = await archiveRoot();
  if (!root) return null;
  const candidates = await getDb()
    .select({ source: runs.sourceFilePath, name: stores.name })
    .from(runs)
    .innerJoin(stores, eq(runs.storeId, stores.id))
    .where(and(eq(runs.storeId, storeId), reportsForDay(date)))
    .orderBy(desc(runs.downloadedAt), desc(runs.id));

  for (const candidate of candidates) {
    const original = await openOriginal(root, candidate.source);
    if (original) return { ...original, name: downloadFilename(candidate.name, date, original.extension) };
  }
  return null;
}
