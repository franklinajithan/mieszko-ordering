import { z } from "zod";
import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { report6Date, report6Days, report6Id, report6Key, report6Store, report6Stores } from "@/lib/item-sales-enquiry";
import { getReport6Job, launchReport6, report6Config, report6Headers, report6History } from "@/services/item-sales-enquiry.service";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";

export const runtime = "nodejs";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), start: report6Date, end: report6Date, stores: z.array(report6Store).min(1).max(7) }),
  z.object({ action: z.literal("retry"), id: report6Id }),
  z.object({ action: z.literal("redownload"), reports: z.array(report6Key).min(1).max(2562) }),
]);

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: report6Headers });
}

export async function GET() {
  try {
    return Response.json({ enabled: Boolean(report6Config()), history: await report6History() }, { headers: report6Headers });
  } catch {
    return error("Report 6 history is unavailable.", 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginSubmission(request)) return error("Cross-origin requests are not permitted.", 403);
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Select valid dates and at least one store or report.", 400);
  const data = parsed.data;
  const today = todayIso();
  try {
    let reports;
    if (data.action === "start") {
      const count = report6Days(data.start, data.end);
      if (count < 1 || count > 366 || data.end > today) {
        return error("Select up to 366 days, ending today or earlier.", 400);
      }
      reports = Object.keys(report6Stores).map(store => report6Store.parse(store))
        .filter(store => data.stores.includes(store))
        .flatMap(store => Array.from({ length: count }, (_, index) => ({ store, date: addDaysIso(data.start, index) })));
    } else if (data.action === "retry") {
      const previous = await getReport6Job(data.id);
      if (!previous) return error("Report 6 job was not found.", 404);
      if (previous.state === "running") return error("Wait for the current job to finish.", 409);
      reports = previous.reports.filter(row => row.state === "failed").map(({ store, date }) => ({ store, date }));
      if (!reports.length) return error("This job has no failed reports.", 400);
    } else {
      reports = [...new Map(data.reports.map(row => [`${row.store}/${row.date}`, row])).values()];
      if (reports.some(row => row.date > today)) return error("Select today or an earlier date.", 400);
    }
    const result = await launchReport6(reports, data.action !== "start");
    if (result.status === "busy") return error("A Report 6 job is already running.", 409);
    if (result.status === "ready") return Response.json({ id: result.id }, { status: 202, headers: report6Headers });
  } catch {
    // Keep worker paths and CRM credentials out of the response.
  }
  return error("Could not start Report 6. Check the Ubuntu worker configuration.", 503);
}
