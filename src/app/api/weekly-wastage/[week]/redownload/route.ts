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
    unavailable: [503, "Could not start the weekly wastage worker."],
  } as const;
  const [status, error] = errors[result];
  return Response.json({ error }, { status, headers });
}
