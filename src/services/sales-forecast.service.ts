import { getDay, eachDayOfInterval, isSameDay } from "date-fns";
import { Decimal, toDecimal } from "@/utils/decimal";

export type ForecastInput = {
  storeProductId: string;
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

    const weekdayTotals = new Map<number, { sum: Decimal; count: number }>();

    for (const range of input.periodRanges) {
      for (const day of eachDayOfInterval({
        start: range.startDate,
        end: range.endDate,
      })) {
        const key = day.toISOString().slice(0, 10);
        const qty = input.historicalSalesByDate.get(key) ?? new Decimal(0);
        const weekday = getDay(day);
        const existing = weekdayTotals.get(weekday) ?? {
          sum: new Decimal(0),
          count: 0,
        };
        existing.sum = existing.sum.plus(qty);
        existing.count += 1;
        weekdayTotals.set(weekday, existing);
      }
    }

    const weekdayAverage = new Map<number, Decimal>();
    for (const [weekday, { sum, count }] of weekdayTotals) {
      weekdayAverage.set(
        weekday,
        count > 0 ? sum.div(count) : new Decimal(0),
      );
    }

    let total = new Decimal(0);
    for (const day of eachDayOfInterval({
      start: input.fromDate,
      end: input.toDate,
    })) {
      if (isSameDay(day, input.toDate)) continue;
      const weekday = getDay(day);
      total = total.plus(weekdayAverage.get(weekday) ?? new Decimal(0));
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
