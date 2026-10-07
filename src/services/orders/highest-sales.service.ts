import { Decimal, decimalMax, toDecimal } from "@/utils/decimal";

/** Isolated formula – may change later. */
export function calculateHighestSoldQty(
  sales: Array<Decimal | string | number>,
): Decimal {
  if (!sales.length) return new Decimal(0);
  return decimalMax(...sales.map((value) => toDecimal(value)));
}
