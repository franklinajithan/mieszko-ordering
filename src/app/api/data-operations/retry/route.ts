import { z } from 'zod';
import { apiError, apiOk, parseJson, route } from '@/lib/api/http';
import { isSameOriginSubmission } from '@/lib/api/same-origin';
import { retryFailedImportRun } from '@/services/data-import-run.service';
const schema=z.object({runId:z.number().int().positive()});
export const POST=route(async request=>{
  if (!isSameOriginSubmission(request)) return apiError('Cross-origin requests are not permitted.',403);
  const parsed=await parseJson(request,schema);
  if (!parsed.ok) return parsed.response;
  const result=await retryFailedImportRun(parsed.data.runId);
  return apiOk({...result,message:result.alreadyQueued?'An import for this store and feed is already queued or running.':'Import retry queued for the office worker.'},result.alreadyQueued?200:202);
});
