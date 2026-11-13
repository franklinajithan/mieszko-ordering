import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { dailyWastageDate } from "@/services/daily-wastage.service";
import { getDailyWastageRun, startDailyWastageRun } from "@/services/daily-wastage-run.service";
import { todayIso } from "@/utils/order-sheet-form";

export const runtime = "nodejs";

type Context = { params: Promise<{ date: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: Context) {
  const { date } = await params;
  if (!dailyWastageDate.safeParse(date).success) return Response.json({ error: "Invalid report date." }, { status: 400, headers });
  try {
    return Response.json(await getDailyWastageRun(date), { headers });
  } catch {
    return Response.json({ error: "Progress is unavailable." }, { status: 503, headers });
  }
}

export async function POST(request: Request, { params }: Context) {
  const { date } = await params;
  if (!isSameOriginSubmission(request)) return Response.json({ error: "Cross-origin requests are not permitted." }, { status: 403, headers });
  if (!dailyWastageDate.safeParse(date).success || date > todayIso()) {
    return Response.json({ error: "Select today or an earlier report date." }, { status: 400, headers });
  }
  const target = new URL(request.url).searchParams.get("storeId");
  const storeId = target === null ? undefined : Number(target);
  if (target !== null && (!/^[1-9]\d*$/.test(target) || !Number.isSafeInteger(storeId))) {
    return Response.json({ error: "Invalid store." }, { status: 400, headers });
  }
  try {
    if (storeId !== undefined) {
      const run = await getDailyWastageRun(date);
      if (!run || run.state === "running" || !run.stores.some(store => store.id === storeId && store.state === "failed")) {
        return Response.json({ error: "Only failed store exports can be retried after the current run ends." }, { status: 409, headers });
      }
    }
    if (await startDailyWastageRun(date, storeId)) return Response.json(await getDailyWastageRun(date), { status: 202, headers });
  } catch {
    // Keep worker paths and diagnostics out of the browser response.
  }
  return Response.json({ error: "Could not start the PDF export. Check the Ordering worker configuration." }, { status: 503, headers });
}
