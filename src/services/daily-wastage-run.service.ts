import "server-only";

import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dailyWastageArchiveRoot, listDailyWastage } from "./daily-wastage.service";

const runSchema = z.object({
  state: z.enum(["running", "complete", "failed"]),
  message: z.string(),
  updatedAt: z.number(),
  stores: z.array(z.object({
    id: z.number(),
    name: z.string(),
    state: z.enum(["waiting", "running", "complete", "failed"]),
    step: z.string(),
  })),
});

export type DailyWastageRun = z.infer<typeof runSchema>;

export function manualWastageEnabled() {
  const worker = process.env.DAILY_WASTAGE_WORKER_DIRECTORY;
  return Boolean(worker && path.isAbsolute(worker));
}

export async function getDailyWastageRun(date: string) {
  const archive = await dailyWastageArchiveRoot();
  if (!archive) return null;
  const file = path.join(archive, ".manual-pdfs", date, "status.json");
  try {
    if (await realpath(file) !== file) return null;
    const run = runSchema.parse(JSON.parse(await readFile(file, "utf8")));
    if (run.state === "running" && Date.now() - run.updatedAt > 35 * 60 * 1000) {
      return {
        ...run,
        state: "failed" as const,
        message: "No recent export progress.",
        stores: run.stores.map(store => store.state === "waiting" || store.state === "running"
          ? { ...store, state: "failed" as const, step: "Export stopped before the PDF was ready" }
          : store),
      };
    }
    return run;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function startDailyWastageRun(date: string, storeId?: number) {
  const worker = process.env.DAILY_WASTAGE_WORKER_DIRECTORY;
  const archive = await dailyWastageArchiveRoot();
  if (!worker || !path.isAbsolute(worker) || !archive) return false;
  const reports = await listDailyWastage(date);
  if (reports.state !== "ready") return false;
  const finalStores = reports.stores.filter(store => store.final).map(store => String(store.storeId));
  const child = spawn(path.join(worker, ".worker-runtime/venv/bin/python"), [
    path.join(process.cwd(), "automation/manual-wastage-pdf.py"),
    "--worker-directory", worker, "--archive", archive, "--date", date, "--keep-final", ...finalStores,
    ...(storeId === undefined ? [] : ["--retry-store", String(storeId)]),
  ], { detached: true, stdio: ["ignore", "pipe", "ignore"] });

  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 10000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.stdout.once("data", data => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.unref();
      resolve(String(data).trim() === "ready");
    });
  });
}
