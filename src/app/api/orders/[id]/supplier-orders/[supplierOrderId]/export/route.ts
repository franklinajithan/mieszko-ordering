import {z} from 'zod';
import { apiError, apiOk, parseJson, route } from '@/lib/api/http';
import { exportSupplierOrder } from '@/services/orders/supplier-order.service';
export const POST=route(async (request,{params}:{params:Promise<{id:string;supplierOrderId:string}>})=>{
  const {id,supplierOrderId}=await params;
  const orderId=Number(id),draftId=Number(supplierOrderId);
  if (![orderId,draftId].every(value=>Number.isSafeInteger(value)&&value>0)) return apiError('Invalid order identifiers');
  const parsed=await parseJson(request,z.object({acknowledgeWarnings:z.boolean().optional()}));if(!parsed.ok)return parsed.response;
  return apiOk(await exportSupplierOrder(orderId,draftId,parsed.data));
});
