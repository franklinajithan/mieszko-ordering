import { Decimal, decimalMax, toDecimal } from "@/utils/decimal";

export type PeriodSales = {
  period1: Decimal;
  period2: Decimal;
  period3: Decimal;
  previousYear: Decimal;
};

/** Isolated formula – may change later. */
export function calculateHighestSoldQty(sales: PeriodSales): Decimal {
  return decimalMax(
    sales.period1,
    sales.period2,
    sales.period3,
    sales.previousYear,
  );
}

export function periodSalesFromValues(values: {
  period1Sales: string | number;
  period2Sales: string | number;
  period3Sales: string | number;
  previousYearSales: string | number;
}): PeriodSales {
  return {
    period1: toDecimal(values.period1Sales),
    period2: toDecimal(values.period2Sales),
    period3: toDecimal(values.period3Sales),
    previousYear: toDecimal(values.previousYearSales),
  };
}
