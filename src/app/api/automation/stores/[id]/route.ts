import { apiError, apiOk, numericParam, parseJson, route } from "@/lib/api/http";
import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { saveCrmStore } from "@/services/crm-automation.service";
import { crmStoreSettingsSchema } from "@/validators/crm-automation";

export const PUT = route(async (request, { params }: { params: Promise<{ id: string }> }) => {
  if (!isSameOriginSubmission(request)) return apiError('Cross-origin requests are not permitted.', 403);
  const id = await numericParam(params);
  if (id === null) return apiError('Invalid store.');
  const parsed = await parseJson(request, crmStoreSettingsSchema);
  if (!parsed.ok) return parsed.response;
  return apiOk(await saveCrmStore(id, parsed.data));
});
