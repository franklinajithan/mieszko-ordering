import { report6Date } from "@/lib/item-sales-enquiry";
import { listReport6Archive, report6ZipResponse } from "@/services/item-sales-enquiry-archive.service";
import { report6Headers } from "@/services/item-sales-enquiry.service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ date: string }> }) {
  const date = report6Date.safeParse((await params).date);
  if (!date.success) return new Response("Invalid report date.", { status: 400, headers: report6Headers });

  try {
    if (new URL(request.url).searchParams.get("download") === "zip") {
      return await report6ZipResponse(date.data);
    }
    return Response.json(await listReport6Archive(date.data), { headers: report6Headers });
  } catch {
    return new Response("Report 6 archive is temporarily unavailable.", { status: 503, headers: report6Headers });
  }
}
