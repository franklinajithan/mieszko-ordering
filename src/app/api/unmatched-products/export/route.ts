import { NextResponse } from "next/server";
import { route } from "@/lib/api/http";
import {
  listIdentifiers,
  parseFilters,
} from "@/services/reconciliation/reconciliation.service";
import { buildReviewWorkbook } from "@/services/reconciliation/workbook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = route(async (request) => {
  const result = await listIdentifiers(
    parseFilters(new URL(request.url).searchParams),
    true,
  );
  const buffer = await buildReviewWorkbook(result.items);
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="Mieszko_Unmatched_Products_Review.xlsx"',
      "Cache-Control": "no-store",
    },
  });
});
