import { apiError, apiOk, route } from '@/lib/api/http';
import { exportSupplierOrder } from '@/services/orders/supplier-order.service';
export const POST=route(async (_req,{params}:{params:Promise<{id:string;supplierOrderId:string}>})=>{
  const {id,supplierOrderId}=await params;
  const orderId=Number(id),draftId=Number(supplierOrderId);
  if (![orderId,draftId].every(value=>Number.isSafeInteger(value)&&value>0)) return apiError('Invalid order identifiers');
  return apiOk(await exportSupplierOrder(orderId,draftId));
});
