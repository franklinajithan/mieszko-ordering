import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { downloadPlan } from "@/lib/report-downloader";
import { downloadHeaders, downloaderConfig, launchDownloader, recentDownloaderJobs } from "@/services/report-downloader.service";
import { readDownloaderWorkbooks } from "@/services/report-downloader-workbooks";
import { todayIso } from "@/utils/order-sheet-form";

export const runtime = "nodejs";

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: downloadHeaders });
}

export async function GET() {
  try {
    return reply({ enabled: Boolean(downloaderConfig()), history: await recentDownloaderJobs() });
  } catch {
    return reply({ error: "Could not load download history." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginSubmission(request)) return reply({ error: "Cross-origin requests are not permitted." }, 403);
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    const size = Number(request.headers.get("content-length"));
    if (!size || size > 540_000) return reply({ error: "Select two Excel workbooks up to 256 KB each." }, 413);
    try {
      return reply({ plan: await readDownloaderWorkbooks(await request.formData()) });
    } catch (error) {
      const message = error instanceof Error && /^(Select |Workbook must|The (Control|Stores) sheet|Stores row|Control row|Enable at least)/.test(error.message)
        ? error.message : "Could not read the Excel workbooks. Check the workbook format.";
      return reply({ error: message }, 400);
    }
  }
  const plan = downloadPlan.safeParse(await request.json().catch(() => null));
  const today = todayIso();
  if (!plan.success || plan.data.ranges.some(row => row.end > today)) {
    return reply({ error: "Select valid stores and report date ranges ending today or earlier." }, 400);
  }
  if (plan.data.ranges.filter(row => row.report === "item_sales").length > 10 ||
      plan.data.ranges.filter(row => row.report === "daily_item_volume").length > 1) {
    return reply({ error: "Use up to 10 Item Sales ranges and one Daily Item Volume range." }, 400);
  }
  try {
    const result = await launchDownloader(plan.data);
    if (result.status === "ready") return reply({ id: result.id }, 202);
    if (result.status === "busy") return reply({ error: "A report download is already running. Open it in Recent runs." }, 409);
  } catch {
    // Keep office paths and credentials on the worker.
  }
  return reply({ error: "Could not start the downloader. Check the Ubuntu worker settings." }, 503);
}
