import {z} from 'zod';
import { apiError, apiOk, numericParam, parseJson, route } from '@/lib/api/http';
import { generateSupplierOrders, listSupplierOrders } from '@/services/orders/supplier-order.service';
type Context={params:Promise<{id:string}>};
export const GET=route(async (request,{params}:Context)=>{
  const id=await numericParam(params); if (id===null) return apiError('Invalid order id');
  return apiOk(await listSupplierOrders(id));
});
export const POST=route(async (request,{params}:Context)=>{
  const id=await numericParam(params); if (id===null) return apiError('Invalid order id');
  const parsed=await parseJson(request,z.object({acknowledgeWarnings:z.boolean().optional()}));if(!parsed.ok)return parsed.response;
  await generateSupplierOrders(id,parsed.data); return apiOk(await listSupplierOrders(id));
});
