import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { queueDailyMovementImports } from "@/services/crm-automation.service";
import { queueMovementSchema } from "@/validators/crm-automation";

export const POST = route(async request => {
  if (!isSameOriginSubmission(request)) return apiError('Cross-origin requests are not permitted.', 403);
  const parsed = await parseJson(request, queueMovementSchema);
  if (!parsed.ok) return parsed.response;
  return apiOk(await queueDailyMovementImports(parsed.data), 202);
});
