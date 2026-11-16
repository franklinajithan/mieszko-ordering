import 'server-only';
import { orderRepository } from '@/repositories';
import { generateOrderSheet, settingsFromOrder } from '@/services/order-sheet.service';
export async function recalculateSavedOrder(orderId:number,changes:{supplierIds?:number[];comparisonPeriods?:Array<{startDate:string;endDate:string}>}) {
  const order=await orderRepository.getById(orderId);
  if (!order) throw new Error('Order not found');
  const settings=settingsFromOrder(order);
  return generateOrderSheet({...settings,orderId,deliveryDate:order.deliveryDate,departmentIds:order.departmentIds,comment:order.comment??undefined,supplierIds:changes.supplierIds??order.supplierIds,comparisonPeriods:changes.comparisonPeriods??order.comparisonPeriods});
}
