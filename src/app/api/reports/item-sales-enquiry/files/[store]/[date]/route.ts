import { report6Key } from "@/lib/item-sales-enquiry";
import { report6FileResponse, report6Headers } from "@/services/item-sales-enquiry.service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ store: string; date: string }> }) {
  const key = report6Key.safeParse(await params);
  if (!key.success) return new Response("Invalid report file.", { status: 400, headers: report6Headers });
  try {
    return await report6FileResponse(key.data);
  } catch {
    return new Response("Workbook temporarily unavailable.", { status: 503, headers: report6Headers });
  }
}
