import {apiError,apiOk,numericParam,route} from '@/lib/api/http';
import {validateOrderForExport} from '@/services/orders/order-validation.service';
export const GET=route(async(_request,{params}:{params:Promise<{id:string}>})=>{
 const id=await numericParam(params);if(id===null)return apiError('Invalid order id');
 return apiOk(await validateOrderForExport(id));
});
