import { apiError, apiOk, numericParam, route } from '@/lib/api/http';
import { generateSupplierOrders, listSupplierOrders } from '@/services/orders/supplier-order.service';
type Context={params:Promise<{id:string}>};
export const GET=route(async (_req,{params}:Context)=>{
  const id=await numericParam(params); if (id===null) return apiError('Invalid order id');
  return apiOk(await listSupplierOrders(id));
});
export const POST=route(async (_req,{params}:Context)=>{
  const id=await numericParam(params); if (id===null) return apiError('Invalid order id');
  await generateSupplierOrders(id); return apiOk(await listSupplierOrders(id));
});
