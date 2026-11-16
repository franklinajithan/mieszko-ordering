import { notFound } from 'next/navigation';
import { orderRepository } from '@/repositories';
import { buildOrderSheetResult } from '@/services/order-sheet.service';
import { SavedOrder } from '@/components/orders/saved-order';
export default async function SavedOrderPage({ params }: {params: Promise<{id:string}>}) {
  const {id} = await params;
  const orderId=Number(id);
  if (!Number.isSafeInteger(orderId) || orderId<1) notFound();
  const order=await orderRepository.getById(orderId);
  if (!order) notFound();
  const result=await buildOrderSheetResult(orderId);
  return <SavedOrder result={result} includeRtc={order.includeRtc} includeWastage={order.includeWastage} comment={order.comment ?? ''} />;
}
