import { NextResponse } from "next/server";
import { z } from "zod";
import { queueBookStockRefresh } from "@/services/data-import-run.service";
import { route, parseJson } from "@/lib/api/http";

const schema = z.object({ storeId: z.number().int().positive() });

/**
 * Queues an office-local job. No CRM call is made by this web request.
 * Uses the existing application route wrapper for access control/error handling.
 */
export const POST = route(async (request) => {
  // Reject cross-site browser submissions; this is CSRF protection, not user authorization.
  const origin = request.headers.get("origin");
  if (origin) {
    const expected = new URL(request.url).origin;
    if (origin !== expected) {
      return NextResponse.json({ success: false, error: "Cross-origin requests are not permitted." }, { status: 403 });
    }
  }
  const parsed = await parseJson(request, schema);
  if (!parsed.ok) return parsed.response;
  const queued = await queueBookStockRefresh(parsed.data.storeId);
  return NextResponse.json({
    success: true,
    queued: true,
    runId: queued.runId,
    alreadyQueued: queued.alreadyQueued,
    message: queued.alreadyQueued
      ? "A book-stock refresh is already queued or running."
      : "Book-stock refresh queued for the office worker.",
  }, { status: queued.alreadyQueued ? 200 : 202 });
});
