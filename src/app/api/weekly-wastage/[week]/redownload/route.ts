import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { redownloadWeeklyWastage } from "@/services/weekly-wastage.service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ week: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isSameOriginSubmission(request)) {
    return Response.json({ error: "Cross-origin requests are not permitted." }, { status: 403, headers });
  }
  const { week } = await params;
  const result = await redownloadWeeklyWastage(week);
  if (result === "started") return Response.json({ started: true }, { status: 202, headers });
  const errors = {
    invalid: [400, "Select a completed Monday to Sunday report week."],
    missing: [404, "That report week is unavailable."],
    busy: [409, "A weekly wastage run is already in progress."],
    unavailable: [503, "Could not read the weekly report archive or status."],
    runtime_missing: [503, "The web service cannot access the weekly Python runtime or worker script."],
    archive_readonly: [503, "The web service cannot write to the weekly report folder."],
    worker_failed: [503, "The weekly worker exited before starting. Check the web service log."],
    startup_timeout: [503, "The weekly worker did not confirm startup. Refresh the status before retrying."],
  } as const;
  const [status, error] = errors[result];
  return Response.json({ error }, { status, headers });
}
