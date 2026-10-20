import {z} from 'zod';
import {apiError,apiOk,parseJson,route} from '@/lib/api/http';
import {isSameOriginSubmission} from '@/lib/api/same-origin';
import {controlDownload,getDownloadQueue} from '@/services/download-queue.service';
const filters=z.object({storeId:z.coerce.number().int().positive().optional(),feed:z.enum(['normal_sales','rtc','wastage','book_stock']).optional(),view:z.enum(['processing','queued','paused','completed','partial','failed','cancelled','all']).default('processing'),page:z.coerce.number().int().min(1).max(100000).default(1)});
export const GET=route(async request=>{
 const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return apiError('Choose valid queue filters.');
 return apiOk(await getDownloadQueue(parsed.data));
});
const command=z.object({runId:z.number().int().positive().safe(),action:z.enum(['pause','resume','cancel','redownload'])});
export const POST=route(async request=>{
 if(!isSameOriginSubmission(request))return apiError('Cross-origin requests are not permitted.',403);
 const parsed=await parseJson(request,command);if(!parsed.ok)return parsed.response;
 return apiOk(await controlDownload(parsed.data.runId,parsed.data.action));
});
