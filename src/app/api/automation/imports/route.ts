import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { isSameOriginSubmission } from "@/lib/api/same-origin";
import { queueDailyMovementImports, getDailyImportProgress } from "@/services/crm-automation.service";
import { queueMovementSchema, historicalMovementSchema } from "@/validators/crm-automation";

export const GET = route(async request => {
  const params = new URL(request.url).searchParams;
  const parsed = historicalMovementSchema.safeParse({
    storeIds: (params.get('stores') ?? '').split(',').map(Number),
    feeds: (params.get('feeds') ?? '').split(','),
    startDate: params.get('from'), endDate: params.get('to'),
  });
  if (!parsed.success) return apiError(parsed.error.issues.map(issue=>issue.message).join(' '));
  return apiOk(await getDailyImportProgress(parsed.data));
});

export const POST = route(async request => {
  if (!isSameOriginSubmission(request)) return apiError('Cross-origin requests are not permitted.', 403);
  const parsed = await parseJson(request, queueMovementSchema);
  if (!parsed.ok) return parsed.response;
  return apiOk(await queueDailyMovementImports(parsed.data), 202);
});
