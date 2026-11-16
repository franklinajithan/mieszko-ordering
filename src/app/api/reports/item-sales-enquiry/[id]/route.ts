import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { report6Id } from "@/lib/item-sales-enquiry";
import { cancelReport6, getReport6Job, report6Headers } from "@/services/item-sales-enquiry.service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  try {
    const job = await getReport6Job(id);
    if (job) return Response.json(job, { headers: report6Headers });
    return Response.json({ error: "Report 6 job was not found." }, { status: 404, headers: report6Headers });
  } catch {
    return Response.json({ error: "Report 6 progress is unavailable." }, { status: 503, headers: report6Headers });
  }
}

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginSubmission(request)) {
    return Response.json({ error: "Cross-origin requests are not permitted." }, { status: 403, headers: report6Headers });
  }
  const { id } = await params;
  try {
    if (report6Id.safeParse(id).success && await cancelReport6(id)) {
      return Response.json({ cancelling: true }, { status: 202, headers: report6Headers });
    }
    return Response.json({ error: "This job is no longer running." }, { status: 409, headers: report6Headers });
  } catch {
    return Response.json({ error: "Cancellation is unavailable." }, { status: 503, headers: report6Headers });
  }
}
