import type { OrderSheetItem } from '@/types/orderSheet';
import { decimalToDb, parseDbDecimal } from '@/utils/decimal';

export function previewOrderItem(item: OrderSheetItem, patch: Partial<Pick<OrderSheetItem,'orderQty'|'selected'>>): OrderSheetItem {
  const next = {...item,...patch};
  const valid = /^\d{1,14}(\.\d{1,4})?$/.test(next.orderQty);
  if (patch.orderQty !== undefined && valid) next.selected = parseDbDecimal(next.orderQty).gt(0);
  const qty = valid && next.selected ? parseDbDecimal(next.orderQty) : null;
  next.estimatedLineCost = qty && next.cheapestNetPrice ? decimalToDb(qty.times(parseDbDecimal(next.cheapestNetPrice))) : qty ? null : valid ? '0.0000' : null;
  next.quantityOverridden = true;
  return next;
}
