import { Readable } from "node:stream";

import { openWeeklyWastageZip } from "@/services/weekly-wastage.service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const archive = await openWeeklyWastageZip(week);
  if (!archive) {
    return new Response("This weekly wastage ZIP is unavailable.", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const body = Readable.toWeb(archive.file.createReadStream()) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archive.name}"`,
      "Content-Length": String(archive.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
