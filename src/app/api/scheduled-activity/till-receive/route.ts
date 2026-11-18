import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const exec = promisify(execFile);
const stores = ["HNS", "PRV", "EHM", "HAY", "GRV", "WAT", "STR"];
const directory = process.env.TILL_RECEIVE_STATE_DIRECTORY || path.join(os.homedir(), ".mieszko-till-receive");
const historyFile = path.join(directory, "history.json");
const lockFile = path.join(directory, "run.lock");

type Entry = { at: string; store: string; mode: string; status: string; output: string };
async function history(): Promise<Entry[]> {
  try { return JSON.parse(await readFile(historyFile, "utf8")) as Entry[]; }
  catch { return []; }
}
export async function GET() {
  return NextResponse.json({ stores, history: (await history()).slice(0, 40), executionEnabled: process.env.TILL_RECEIVE_EXECUTION_ENABLED === "1" });
}
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (process.env.TILL_RECEIVE_API_TOKEN && req.headers.get("x-till-receive-token") !== process.env.TILL_RECEIVE_API_TOKEN) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data: unknown = await req.json().catch(() => null);
  if (!data || typeof data !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { store, mode, confirmation } = data as Record<string, unknown>;
  if (typeof store !== "string" || !stores.includes(store) || (mode !== "preview" && mode !== "execute"))
    return NextResponse.json({ error: "Invalid store or mode" }, { status: 400 });
  if (mode === "execute" && (process.env.TILL_RECEIVE_EXECUTION_ENABLED !== "1" || confirmation !== "RECEIVE"))
    return NextResponse.json({ error: "Execution disabled or confirmation missing" }, { status: 403 });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(lockFile, "wx", 0o600); }
  catch { return NextResponse.json({ error: "Another Till Receive run is active. Inspect the lock before retrying." }, { status: 409 }); }
  const entry: Entry = { at: new Date().toISOString(), store, mode: String(mode), status: "failed", output: "" };
  try {
    const script = process.env.TILL_RECEIVE_SCRIPT || path.join(process.cwd(), "automation", "till_receive.py");
    const python = process.env.TILL_RECEIVE_PYTHON || [process.cwd(), ".worker-runtime", "venv", "bin", "python"].join("/");
    const args = [script, "--store", store];
    if (mode === "preview") args.push("--preview");
    const result = await exec(python, args, { cwd: process.cwd(), timeout: 240000, maxBuffer: 1024 * 1024, env: process.env });
    entry.output = (result.stdout + "\n" + result.stderr).slice(-12000);
    entry.status = "success";
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string };
    entry.output = ((e.stdout || "") + "\n" + (e.stderr || "") + "\n" + e.message).slice(-12000);
  } finally {
    try { const entries = await history(); await writeFile(historyFile, JSON.stringify([entry, ...entries].slice(0, 200), null, 2), { mode: 0o600 }); } finally {
      await lock.close();
      await unlink(lockFile).catch(() => {});
    }
  }
  return NextResponse.json(entry, { status: entry.status === "success" ? 200 : 500 });
}
