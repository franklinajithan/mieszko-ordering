import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdir, open, readFile, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const exec = promisify(execFile);
const directory = process.env.TILL_RECEIVE_STATE_DIRECTORY || path.join(os.homedir(), ".mieszko-till-receive");
const allStores = ["HNS", "PRV", "EHM", "HAY", "GRV", "WAT", "STR"];
type Entry = { at: string; store: string; mode: string; status: string; output: string };
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== request.headers.get("host"))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (process.env.TILL_RECEIVE_API_TOKEN && request.headers.get("x-till-receive-token") !== process.env.TILL_RECEIVE_API_TOKEN)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.stores) || !body.stores.length ||
      body.stores.length > allStores.length ||
      body.stores.some((store: unknown) => typeof store !== "string" || !allStores.includes(store)) ||
      new Set(body.stores).size !== body.stores.length || body.confirmation !== "RECEIVE")
    return NextResponse.json({ error: "Invalid store selection or confirmation" }, { status: 400 });

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockFile = path.join(directory, "run.lock");
  let lock;
  try { lock = await open(lockFile, "wx", 0o600); }
  catch { return NextResponse.json({ error: "Till Receive is already running. Try again after it finishes." }, { status: 409 }); }
  const results: Entry[] = [];
  try {
    const python = process.env.TILL_RECEIVE_PYTHON || [process.cwd(), ".worker-runtime", "venv", "bin", "python"].join("/");
    const script = process.env.TILL_RECEIVE_SCRIPT || path.join(process.cwd(), "automation", "till_receive.py");
    for (const store of body.stores as string[]) {
      const entry: Entry = { at: new Date().toISOString(), store, mode: "manual", status: "failed", output: "" };
      try {
        const result = await exec(python, [script, "--store", store], {
          cwd: process.cwd(), timeout: 240000, maxBuffer: 1024 * 1024, env: process.env
        });
        entry.status = "success";
        entry.output = (result.stdout + "\n" + result.stderr).slice(-12000);
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string };
        entry.output = ((failure.stdout || "") + "\n" + (failure.stderr || "") + "\n" + failure.message).slice(-12000);
      }
      results.push(entry);
      const historyFile = path.join(directory, "history.json");
      let previous: Entry[] = [];
      try { previous = JSON.parse(await readFile(historyFile, "utf8")) as Entry[]; } catch {}
      await writeFile(historyFile, JSON.stringify([entry, ...previous].slice(0, 200), null, 2), { mode: 0o600 });
    }
  } finally {
    await lock.close();
    await unlink(lockFile).catch(() => {});
  }
  return NextResponse.json({ results, success: results.filter(r => r.status === "success").length, failed: results.filter(r => r.status === "failed").length });
}
