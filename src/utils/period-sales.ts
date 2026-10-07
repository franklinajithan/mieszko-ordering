export type PeriodSaleRow = {
  periodKey: string;
  soldQty: string;
};

export function periodKeyForIndex(index: number): string {
  return `period_${index + 1}`;
}

export function soldQtyForPeriod(
  periodSales: PeriodSaleRow[] | null | undefined,
  periodKey: string,
): string {
  return periodSales?.find((row) => row.periodKey === periodKey)?.soldQty ?? "0";
}

export function periodSalesList(
  periodSales: PeriodSaleRow[] | null | undefined,
  periodCount: number,
): string[] {
  const byKey = new Map((periodSales ?? []).map((row) => [row.periodKey, row.soldQty]));
  return Array.from({ length: periodCount }, (_, index) => {
    return byKey.get(periodKeyForIndex(index)) ?? "0";
  });
}

export function toPeriodSalesRows(
  salesByKey: Record<string, string>,
  periodKeys: string[],
): PeriodSaleRow[] {
  return periodKeys.map((periodKey) => ({
    periodKey,
    soldQty: salesByKey[periodKey] ?? "0",
  }));
}
