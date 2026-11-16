import { apiOk, apiError, route } from "@/lib/api/http";
import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { readCorrections } from "@/services/reconciliation/workbook";
import { previewCorrections } from "@/services/reconciliation/reconciliation.service";
export const runtime = "nodejs";
export const POST = route(async (request) => {
  if (!isSameOriginSubmission(request))
    return apiError("Cross-origin requests are not permitted.", 403);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx"))
    return apiError("Choose a corrected .xlsx workbook.");
  if (file.size > 15 * 1024 * 1024) return apiError("Workbook exceeds 15 MB.");
  return apiOk(
    await previewCorrections(
      await readCorrections(Buffer.from(await file.arrayBuffer())),
    ),
  );
});
