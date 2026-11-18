import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
const root = process.env.MIESZKO_DAILY_REPORT_ROOT || "/home/backend/mieszko-daily-sales-reports/output";
export async function GET(_req:NextRequest,{params}:{params:Promise<{date:string}>}) {
  const {date}=await params;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:"Invalid date"},{status:400});
  const filename=`Mieszko_Sales_Reports_${date}.zip`;
  try {
    const bytes=await readFile(path.join(root,filename));
    return new NextResponse(bytes,{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="${filename}"`,"Content-Length":String(bytes.byteLength),"Cache-Control":"no-store"}});
  } catch {return NextResponse.json({error:"ZIP not available for this date"},{status:404});}
}
