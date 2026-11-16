import { z } from "zod";
import { apiOk, apiError, parseJson, route } from "@/lib/api/http";
import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { approveCorrections } from "@/services/reconciliation/reconciliation.service";
export const runtime = "nodejs";
export const POST = route(async (request) => {
  if (!isSameOriginSubmission(request))
    return apiError("Cross-origin requests are not permitted.", 403);
  const parsed = await parseJson(
    request,
    z.object({
      batchId: z.uuid(),
      operator: z.string().trim().min(1).max(100),
      confirm: z.literal(true),
    }),
  );
  if (!parsed.ok) return parsed.response;
  return apiOk(
    await approveCorrections(parsed.data.batchId, parsed.data.operator),
  );
});
