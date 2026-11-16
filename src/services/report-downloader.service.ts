import "server-only";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { report6Config } from "@/services/item-sales-enquiry.service";
import { launchOfficeReportWorker } from "@/services/office-report-worker";
import { report6Id } from "@/lib/item-sales-enquiry";
import { reportNames, type DownloadJob, type DownloadPlan } from "@/lib/report-downloader";

export const downloadHeaders = { "Cache-Control": "private, no-store" };
export function downloaderConfig() {
  const shared = report6Config();
  const worker = process.env.REPORT_DOWNLOADER_WORKER_DIRECTORY ?? shared?.worker;
  const archive = process.env.REPORT_DOWNLOADER_ARCHIVE_DIRECTORY ?? shared?.archive;
  return process.platform === "linux" && worker && archive && path.isAbsolute(worker) && path.isAbsolute(archive)
    ? { worker, archive } : null;
}

async function jobRoot() {
  const config = downloaderConfig();
  return config ? path.join(await realpath(config.archive), "report-downloader", "jobs") : null;
}

const missing = (error: unknown) => ["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "");

async function readJob(root: string, id: string): Promise<DownloadJob | null> {
  if (!report6Id.safeParse(id).success) return null;
  const file = path.join(root, id, "status.json");
  try {
    if (await realpath(file) !== file) return null;
    const job = JSON.parse(await readFile(file, "utf8")) as DownloadJob;
    if (job.state === "running" && Date.now() - (await stat(path.join(root, id, "heartbeat"))).mtimeMs > 45_000) {
      job.state = "failed";
      for (const row of job.reports) {
        if (row.state === "waiting" || row.state === "running") {
          row.state = "failed";
          row.message = "The worker stopped. Start the same selection to reuse saved files and retry missing reports.";
        }
      }
    }
    return job;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export async function downloaderJob(id: string) {
  const root = await jobRoot();
  return root ? readJob(root, id) : null;
}

export async function recentDownloaderJobs() {
  const root = await jobRoot();
  if (!root) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (missing(error)) return [];
    throw error;
  });
  const jobs = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => readJob(root, entry.name)));
  return jobs.filter(job => job !== null).sort((a, b) => b.startedAt - a.startedAt).slice(0, 15).map(job => ({
    id: job.id, startedAt: job.startedAt, state: job.state, total: job.reports.length,
  }));
}

export async function launchDownloader(plan: DownloadPlan) {
  const config = downloaderConfig();
  if (!config) return { status: "unavailable" as const };
  const id = randomUUID();
  const ranges = [...new Map(plan.ranges.map(row => [`${row.report}/${row.start}/${row.end}`, row])).values()];
  const reports = plan.stores.flatMap(store => Object.keys(reportNames).flatMap(report =>
    ranges.filter(row => row.report === report).map(row => ({ ...row, store, state: "waiting", message: "" }))));
  const result = await launchOfficeReportWorker(config, "report_downloader.py", { id, reports });
  return { ...result, id };
}

export async function openDownloaderZip(id: string) {
  if (!report6Id.safeParse(id).success) return null;
  const root = await jobRoot();
  if (!root || !(await readJob(root, id))?.zipReady) return null;
  const filename = path.join(root, id, "reports.zip");
  try {
    if (await realpath(filename) !== filename) return null;
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (info.isFile() && info.size > 22) return { file, size: info.size };
    } catch (error) {
      await file.close();
      throw error;
    }
    await file.close();
  } catch (error) {
    if (!missing(error)) throw error;
  }
  return null;
}
