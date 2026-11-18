import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const root = process.env.MIESZKO_DAILY_REPORT_ROOT || "/home/backend/mieszko-daily-sales-reports/output";
export async function GET() {
  let files: string[] = [];
  try { files = await readdir(root); } catch { /* not installed */ }
  const archives = await Promise.all(files.filter(f => /^Mieszko_Sales_Reports_\d{4}-\d{2}-\d{2}\.zip$/.test(f)).map(async name => {
    const date = name.slice("Mieszko_Sales_Reports_".length,-4);
    const info = await stat(path.join(root,name));
    let manifest: { expected?:number;success?:number;failed?:number;complete?:boolean } | null = null;
    try { manifest = JSON.parse(await readFile(path.join(root,date,"manifest.json"),"utf8")); } catch {}
    return {date,name,size:info.size,created:info.mtime.toISOString(),manifest};
  }));
  archives.sort((a,b)=>b.date.localeCompare(a.date));
  return NextResponse.json({archives,configured:files.length>0});
}
