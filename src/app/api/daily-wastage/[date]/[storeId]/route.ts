import { Readable } from "node:stream";
import { dailyWastageDate, openDailyWastage } from "@/services/daily-wastage.service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ date: string; storeId: string }> },
) {
  const { date, storeId } = await params;
  const id = Number(storeId);
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!dailyWastageDate.safeParse(date).success || !/^\d+$/.test(storeId) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    return new Response("Invalid report date or store.", { status: 400, headers });
  }
  try {
    const original = await openDailyWastage(date, id);
    if (!original) return new Response("No original wastage PDF is available.", { status: 404, headers });
    return new Response(Readable.toWeb(original.file.createReadStream()) as ReadableStream<Uint8Array>, {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${original.name}"`,
        "Content-Length": String(original.size),
      },
    });
  } catch {
    return new Response("The wastage archive is unavailable.", { status: 503, headers });
  }
}
