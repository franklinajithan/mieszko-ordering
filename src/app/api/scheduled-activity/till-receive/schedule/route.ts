import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dir = process.env.TILL_RECEIVE_STATE_DIRECTORY || path.join(os.homedir(), ".mieszko-till-receive");
const file = path.join(dir, "schedule.json");
const valid = ["1h", "2h", "12h", "nightly"];
const allStores = ["HNS", "PRV", "EHM", "HAY", "GRV", "WAT", "STR"];
const defaults = { frequency: "nightly", time: "00:00", stores: allStores, paused: true, updatedAt: "" };
async function load() {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return { ...defaults, ...value };
  } catch { return defaults; }
}
export async function GET() { return NextResponse.json(await load()); }
export async function PUT(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host"))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (process.env.TILL_RECEIVE_API_TOKEN && req.headers.get("x-till-receive-token") !== process.env.TILL_RECEIVE_API_TOKEN)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !valid.includes(body.frequency) ||
    typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ||
    !Array.isArray(body.stores) || !body.stores.length ||
    body.stores.some((s: unknown) => typeof s !== "string" || !allStores.includes(s)) ||
    new Set(body.stores).size !== body.stores.length || typeof body.paused !== "boolean")
    return NextResponse.json({ error: "Invalid schedule" }, { status: 400 });
  const schedule = { frequency: body.frequency, time: body.time, stores: body.stores, paused: body.paused, updatedAt: new Date().toISOString() };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, "schedule.tmp");
  await writeFile(temp, JSON.stringify(schedule, null, 2), { mode: 0o600 });
  await rename(temp, file);
  return NextResponse.json(schedule);
}
