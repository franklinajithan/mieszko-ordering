import { downloaderJob, downloadHeaders } from "@/services/report-downloader.service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const job = await downloaderJob((await params).id);
    return Response.json(job ?? { error: "Download run not found." }, { status: job ? 200 : 404, headers: downloadHeaders });
  } catch {
    return Response.json({ error: "Could not load the download run." }, { status: 503, headers: downloadHeaders });
  }
}
