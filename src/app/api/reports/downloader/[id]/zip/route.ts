import { Readable } from "node:stream";
import { downloadHeaders, openDownloaderZip } from "@/services/report-downloader.service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const archive = await openDownloaderZip(id);
  if (!archive) return new Response("No completed workbooks are available.", { status: 404, headers: downloadHeaders });
  return new Response(Readable.toWeb(archive.file.createReadStream()) as ReadableStream<Uint8Array>, {
    headers: {
      ...downloadHeaders,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Mieszko_Reports_${id}.zip"`,
      "Content-Length": String(archive.size),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
