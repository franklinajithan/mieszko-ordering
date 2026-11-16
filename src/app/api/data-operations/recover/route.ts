import {z} from 'zod';
import {apiError,apiOk,parseJson,route} from '@/lib/api/http';
import {isSameOriginSubmission} from '@/lib/api/same-origin';
import {recoverInterruptedImport} from '@/services/data-import-run.service';
export const POST=route(async request=>{
 if(!isSameOriginSubmission(request))return apiError('Cross-origin requests are not permitted.',403);
 const parsed=await parseJson(request,z.object({runId:z.number().int().positive(),workerStopped:z.boolean()}));if(!parsed.ok)return parsed.response;
 return apiOk(await recoverInterruptedImport(parsed.data.runId,parsed.data.workerStopped));
});
