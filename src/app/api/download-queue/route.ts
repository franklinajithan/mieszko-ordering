import {z} from 'zod';
import {apiError,apiOk,parseJson,route} from '@/lib/api/http';
import {isSameOriginSubmission} from '@/lib/api/same-origin';
import {controlDownload,getDownloadQueue,reviewProducts,resolveIdentifier} from '@/services/download-queue.service';
const filters=z.object({storeId:z.coerce.number().int().positive().optional(),feed:z.enum(['normal_sales','rtc','wastage','book_stock']).optional(),view:z.enum(['processing','queued','paused','completed','failed','cancelled','all']).default('processing'),page:z.coerce.number().int().min(1).max(100000).default(1)});
export const GET=route(async request=>{
 const url=new URL(request.url);
 if(url.searchParams.has('reviewRunId')){
  const id=z.coerce.number().int().positive().safe().safeParse(url.searchParams.get('reviewRunId'));
  if(!id.success)return apiError('Invalid report ID.');
  return apiOk(await reviewProducts(id.data,(url.searchParams.get('search')??'').slice(0,100)));
 }
 const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return apiError('Choose valid queue filters.');
 return apiOk(await getDownloadQueue(parsed.data));
});
const command=z.object({runId:z.number().int().positive().safe(),action:z.enum(['pause','resume','cancel','redownload','retry_import'])});
export const POST=route(async request=>{
 if(!isSameOriginSubmission(request))return apiError('Cross-origin requests are not permitted.',403);
 const parsed=await parseJson(request,command);if(!parsed.ok)return parsed.response;
 return apiOk(await controlDownload(parsed.data.runId,parsed.data.action));
});

const resolution=z.object({runId:z.number().int().positive().safe(),identifier:z.string().trim().min(1).max(200),storeProductId:z.number().int().positive(),evidence:z.string().trim().min(10).max(1000)});
export const PATCH=route(async request=>{
 if(!isSameOriginSubmission(request))return apiError('Cross-origin requests are not permitted.',403);
 const parsed=await parseJson(request,resolution);if(!parsed.ok)return parsed.response;
 return apiOk(await resolveIdentifier(parsed.data));
});
