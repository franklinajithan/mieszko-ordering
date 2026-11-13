import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  report6Filename, report6Id, type Report6Job, type Report6Key, type Report6Summary,
} from "@/lib/item-sales-enquiry";

export const report6Headers = { "Cache-Control": "private, no-store" };
const workbookType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function report6Config() {
  const worker = process.env.ITEM_SALES_ENQUIRY_WORKER_DIRECTORY ?? process.env.DAILY_WASTAGE_WORKER_DIRECTORY;
  const archive = process.env.ITEM_SALES_ENQUIRY_ARCHIVE_DIRECTORY ?? process.env.DAILY_WASTAGE_DOWNLOAD_DIRECTORY;
  return worker && path.isAbsolute(worker) && archive && path.isAbsolute(archive) ? { worker, archive } : null;
}

async function archiveRoot() {
  const config = report6Config();
  if (!config) return null;
  return path.join(await realpath(config.archive), "item-sales-enquiry");
}

function missing(error: unknown) {
  return ["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "");
}

async function readJob(root: string, id: string): Promise<Report6Job | null> {
  if (!report6Id.safeParse(id).success) return null;
  const folder = path.join(root, "jobs", id);
  const file = path.join(folder, "status.json");
  try {
    if (await realpath(file) !== file) return null;
    const job = JSON.parse(await readFile(file, "utf8")) as Report6Job;
    if (job.state !== "running") return job;
    const heartbeat = await stat(path.join(folder, "heartbeat"));
    if (Date.now() - heartbeat.mtimeMs > 45_000) {
      return {
        ...job, state: "failed", current: null, finishedAt: heartbeat.mtimeMs,
        reports: job.reports.map(row => row.state === "waiting" || row.state === "running"
          ? { ...row, state: "failed", message: "The worker stopped before finishing." } : row),
      };
    }
    job.cancelling = await stat(path.join(folder, "cancel")).then(() => true, error => {
      if (missing(error)) return false;
      throw error;
    });
    return job;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export async function getReport6Job(id: string) {
  const root = await archiveRoot();
  return root ? readJob(root, id) : null;
}

export async function report6History(): Promise<Report6Summary[]> {
  const root = await archiveRoot();
  if (!root) return [];
  const ids = await readdir(path.join(root, "jobs")).catch(error => {
    if (missing(error)) return [];
    throw error;
  });
  const history: Report6Summary[] = [];
  for (const id of ids) {
    const job = await readJob(root, id);
    if (job) {
      const { state, startedAt, finishedAt, start, end, reports } = job;
      history.push({ id, state, startedAt, finishedAt, start, end, total: reports.length,
        failed: reports.filter(row => row.state === "failed").length });
    }
  }
  return history.sort((a, b) => b.startedAt - a.startedAt);
}

export async function launchReport6(reports: Report6Key[], force: boolean) {
  const config = report6Config();
  if (!config) return { status: "unavailable" as const };
  const dates = reports.map(row => row.date).sort();
  const id = randomUUID();
  const payload = { id, start: dates[0], end: dates.at(-1), force,
    reports: reports.map(row => ({ ...row, state: "waiting", message: "" })) };

  return new Promise<{ status: "ready" | "busy" | "unavailable"; id: string }>(resolve => {
    const child = spawn(path.join(config.worker, ".worker-runtime/venv/bin/python"), [
      path.join(process.cwd(), "automation/item_sales_enquiry.py"),
      "--worker-directory", config.worker, "--archive", config.archive,
    ], { detached: true, stdio: ["pipe", "pipe", "ignore"] });
    function finish(status: "ready" | "busy" | "unavailable") {
      clearTimeout(timer);
      child.stdout.destroy();
      child.unref();
      resolve({ status, id });
    }
    const timer = setTimeout(() => {
      child.kill();
      finish("unavailable");
    }, 10_000);
    child.once("error", () => finish("unavailable"));
    child.once("close", () => finish("unavailable"));
    child.stdin.on("error", () => {}); // The child can exit before reading stdin.
    let output = "";
    child.stdout.on("data", chunk => {
      output += String(chunk);
      if (output.includes("\n")) {
        const line = output.split("\n", 1)[0];
        finish(line === "ready" || line === "busy" ? line : "unavailable");
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function cancelReport6(id: string) {
  const root = await archiveRoot();
  if (!root) return false;
  const job = await readJob(root, id);
  if (job?.state !== "running") return false;
  try {
    await writeFile(path.join(root, "jobs", id, "cancel"), "", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return true;
}

export async function openReport6File(key: Report6Key) {
  const root = await archiveRoot();
  if (!root) return null;
  const filename = path.join(root, "files", key.store, `${key.date}.xlsx`);
  try {
    if (await realpath(filename) !== filename) return null;
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (info.isFile() && info.size > 4) {
        const signature = Buffer.alloc(4);
        await file.read(signature, 0, 4, 0);
        if (signature.equals(Buffer.from([0x50, 0x4b, 3, 4]))) return { file, size: info.size };
      }
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

export async function report6FileResponse(key: Report6Key) {
  const workbook = await openReport6File(key);
  if (!workbook) return new Response("Workbook unavailable.", { status: 404, headers: report6Headers });
  const body = Readable.toWeb(workbook.file.createReadStream()) as ReadableStream<Uint8Array>;
  return new Response(body, { headers: {
    ...report6Headers,
    "Content-Type": workbookType,
    "Content-Disposition": `attachment; filename="${report6Filename(key)}"`,
    "Content-Length": String(workbook.size),
    "X-Content-Type-Options": "nosniff",
  } });
}
