import { Decimal, toDecimal } from "@/utils/decimal";

/** Isolated formula – may change later. */
export function calculateSuggestedOrderQty(
  highestSoldQty: Decimal,
  predictedFinalStock: Decimal,
): Decimal {
  const diff = highestSoldQty.minus(predictedFinalStock);
  return Decimal.max(diff, new Decimal(0));
}

export { calculateSuggestedOrderQty as suggestedOrderQtyFormula };
