import "server-only";

import { constants } from "node:fs";
import { open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const date = z.iso.date();
const status = z.object({
  start: date,
  end: date,
  state: z.enum(["running", "complete", "failed"]),
  stage: z.string(),
  stores: z.record(z.string(), z.object({
    state: z.enum(["waiting", "running", "complete", "failed"]),
    attempt: z.number().int().min(1).max(3).nullable(),
  })),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type WeeklyWastageRun = z.infer<typeof status> & { stale: boolean };

function reportsRoot() {
  const root = process.env.WEEKLY_WASTAGE_DIRECTORY;
  return root && path.isAbsolute(root) ? root : null;
}

async function readStatus(root: string, week: string) {
  const raw = await readFile(path.join(root, ".status", `${week}.json`), "utf8");
  const run = status.parse(JSON.parse(raw));
  if (run.start !== week) throw new Error("Invalid report week");
  return run;
}

export async function getWeeklyWastageRuns() {
  const root = reportsRoot();
  if (!root) return { state: "disabled" as const, runs: [] };
  try {
    const entries = await readdir(path.join(root, ".status"), { withFileTypes: true });
    const weeks = entries
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => entry.name.slice(0, -5))
      .filter(week => date.safeParse(week).success)
      .sort().reverse();
    const now = Date.now();
    const runs = await Promise.all(weeks.map(async week => {
      const run = await readStatus(root, week);
      return { ...run, stale: run.state === "running" && now - Date.parse(run.updatedAt) > 18 * 60 * 60 * 1000 };
    }));
    return { state: "ready" as const, runs };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { state: missing ? "ready" as const : "unavailable" as const, runs: [] };
  }
}

function folderDate(iso: string) {
  return iso.split("-").reverse().join(".");
}

export async function openWeeklyWastageZip(week: string) {
  const root = reportsRoot();
  if (!root || !date.safeParse(week).success) return null;
  try {
    const run = await readStatus(root, week);
    if (run.state !== "complete") return null;
    const base = await realpath(root);
    const folder = path.join(base, `Weekly Waste ${folderDate(run.start)} - ${folderDate(run.end)}`);
    if (await realpath(folder) !== folder) return null;
    const file = await open(path.join(folder, "Weekly_Wastage.zip"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size === 0) {
        await file.close();
        return null;
      }
      return { file, size: info.size, name: `Weekly-Wastage-${run.start}-to-${run.end}.zip` };
    } catch (error) {
      await file.close();
      throw error;
    }
  } catch {
    return null;
  }
}
