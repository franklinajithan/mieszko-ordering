import { apiOk, apiError, route } from "@/lib/api/http";
import { isSameOriginSubmission } from "@/lib/api/same-origin";
import {
  listIdentifiers,
  parseFilters,
  refreshReconciliation,
  auditHistory,
  getPreview,
} from "@/services/reconciliation/reconciliation.service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = route(async (request) => {
  const params = new URL(request.url).searchParams;
  if (params.has("audit"))
    return apiOk(await auditHistory(params.get("audit")!));
  if (params.has("batchId"))
    return apiOk(
      await getPreview(params.get("batchId")!, parseFilters(params).page),
    );
  return apiOk(await listIdentifiers(parseFilters(params)));
});
export const POST = route(async (request) => {
  if (!isSameOriginSubmission(request))
    return apiError("Cross-origin requests are not permitted.", 403);
  return apiOk(await refreshReconciliation());
});
