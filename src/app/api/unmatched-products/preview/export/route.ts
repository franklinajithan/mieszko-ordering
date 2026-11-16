import { NextResponse } from "next/server";
import { route } from "@/lib/api/http";
import { validatedWorkbookRows } from "@/services/reconciliation/reconciliation.service";
import { buildReviewWorkbook } from "@/services/reconciliation/workbook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = route(async (request) => {
  const rows = await validatedWorkbookRows(
    new URL(request.url).searchParams.get("batchId") ?? "",
  );
  const buffer = await buildReviewWorkbook(rows);
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="Mieszko_Reconciliation_Validation.xlsx"',
      "Cache-Control": "no-store",
    },
  });
});
