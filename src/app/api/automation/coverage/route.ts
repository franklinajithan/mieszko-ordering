import { z } from 'zod';
import { apiError,apiOk,parseJson,route } from '@/lib/api/http';
import { isSameOriginSubmission } from '@/lib/api/same-origin';
import { historicalMovementSchema,movementFeeds } from '@/validators/crm-automation';
import { downloadMissingReport,getReportCoverage } from '@/services/report-coverage.service';
const paging = z.object({page:z.coerce.number().int().min(1).max(100000).default(1),missingOnly:z.enum(['true','false']).default('true')});
export const GET = route(async request => {
 const params = new URL(request.url).searchParams;
 const scope = historicalMovementSchema.safeParse({storeIds:(params.get('stores')??'').split(',').map(Number),feeds:(params.get('feeds')??'').split(','),startDate:params.get('from'),endDate:params.get('to')});
 const options = paging.safeParse(Object.fromEntries(params));
 if (!scope.success || !options.success) return apiError('Choose stores, movement feeds and up to 366 completed report dates.');
 return apiOk(await getReportCoverage(scope.data,options.data.page,options.data.missingOnly==='true'));
});
const command = z.object({storeId:z.number().int().positive().safe(),feed:z.enum(movementFeeds),day:z.string()});
export const POST = route(async request => {
 if (!isSameOriginSubmission(request)) return apiError('Cross-origin requests are not permitted.',403);
 const parsed = await parseJson(request,command);if (!parsed.ok) return parsed.response;
 const scope = historicalMovementSchema.safeParse({storeIds:[parsed.data.storeId],feeds:[parsed.data.feed],startDate:parsed.data.day,endDate:parsed.data.day});
 if (!scope.success) return apiError('Choose a valid completed report date.');
 return apiOk(await downloadMissingReport(parsed.data.storeId,parsed.data.feed,parsed.data.day),202);
});
