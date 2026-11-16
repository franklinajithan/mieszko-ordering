import { Decimal, toDecimal } from "@/utils/decimal";

export type ForecastInput = {
  storeProductId: number;
  fromDate: Date;
  toDate: Date;
  /** Daily sales keyed by ISO date (yyyy-MM-dd) */
  historicalSalesByDate: Map<string, Decimal>;
  /** Period date ranges used for weekday matching */
  periodRanges: Array<{ startDate: Date; endDate: Date }>;
};

export interface SalesForecastService {
  forecastProductSales(input: ForecastInput): Promise<Decimal>;
}

/**
 * Forecast sales by averaging matching weekday sales from selected historical periods.
 * Replaceable implementation behind SalesForecastService.
 */
export class WeekdayHistoricalForecastService implements SalesForecastService {
  async forecastProductSales(input: ForecastInput): Promise<Decimal> {
    if (input.toDate <= input.fromDate) {
      return new Decimal(0);
    }

    // Business dates use UTC consistently on office PCs and servers, including DST.
    const dayKey = (date: Date) => date.toISOString().slice(0, 10);
    const days = (from: Date, to: Date, inclusive: boolean) => {
      const result: Date[] = [];
      const cursor = new Date(dayKey(from) + "T00:00:00Z");
      const end = new Date(dayKey(to) + "T00:00:00Z");
      while (inclusive ? cursor <= end : cursor < end) {
        result.push(new Date(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return result;
    };
    const weekdayTotals = new Map<number, { sum: Decimal; count: number }>();
    const seen = new Set<string>();
    for (const range of input.periodRanges) {
      for (const day of days(range.startDate, range.endDate, true)) {
        const key = dayKey(day);
        if (seen.has(key)) continue; // Overlapping periods must not weight a day twice.
        seen.add(key);
        const qty = input.historicalSalesByDate.get(key) ?? new Decimal(0);
        if (!qty.isFinite()) throw new Error("Invalid historical sales quantity");
        const weekday = day.getUTCDay();
        const value = weekdayTotals.get(weekday) ?? { sum: new Decimal(0), count: 0 };
        value.sum = value.sum.plus(qty);
        value.count++;
        weekdayTotals.set(weekday, value);
      }
    }
    let total = new Decimal(0);
    for (const day of days(input.fromDate, input.toDate, false)) {
      const value = weekdayTotals.get(day.getUTCDay());
      // Returns can lower demand to zero, but cannot predict negative depletion.
      if (value) total = total.plus(Decimal.max(0, value.sum.div(value.count)));
    }

    return total;
  }
}

export function buildHistoricalSalesMap(
  rows: Array<{ salesDate: string; soldQty: string }>,
): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const row of rows) {
    const existing = map.get(row.salesDate) ?? new Decimal(0);
    map.set(row.salesDate, existing.plus(toDecimal(row.soldQty)));
  }
  return map;
}
