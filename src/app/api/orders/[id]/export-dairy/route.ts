import { exportDairyWorkbook } from '@/services/orders/dairy-workbook.service';
import { apiError,apiOk,numericParam,route } from '@/lib/api/http';
import { isSameOriginSubmission } from '@/lib/api/same-origin';
export const POST=route(async(request,{params}:{params:Promise<{id:string}>})=>{
 if(!isSameOriginSubmission(request))return apiError('Cross-origin requests are not permitted.',403);
 const id=await numericParam(params);if(id===null)return apiError('Invalid order id');
 return apiOk(await exportDairyWorkbook(id));
});
