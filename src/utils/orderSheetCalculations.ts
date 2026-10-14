import { Decimal, decimalToDb, toDecimal } from "@/utils/decimal";
import type { SoldQtyMethod } from "@/types/orderSheet";

export function diffDaysInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
}

export const MAX_DAY_BY_SALES_DAYS = 31;

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function listDatesInclusive(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return dates;
  }
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(formatLocalIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function formatDaySalesLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export function formatIsoDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatComparisonPeriodDateRange(
  startDate: string,
  endDate: string,
): string {
  if (startDate === endDate) return formatIsoDateLabel(startDate);
  return `${formatIsoDateLabel(startDate)} – ${formatIsoDateLabel(endDate)}`;
}

export function periodSalesTotalsFromDailySales(
  salesByProductAndDate: Map<number, Map<string, string>>,
  storeProductId: number,
  periods: Array<{ startDate: string; endDate: string }>,
): string[] {
  const byDate = salesByProductAndDate.get(storeProductId);
  return periods.map((period) =>
    decimalToDb(sumQtyInDateRange(byDate, period.startDate, period.endDate)),
  );
}

export function formatDaySalesHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Normalise date strings from DB/API to YYYY-MM-DD for comparisons. */
export function normalizeIsoDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return formatLocalIsoDate(value);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed.slice(0, 10);
  return formatLocalIsoDate(parsed);
}

export function buildDailySalesByProductMap(
  rows: Array<{ storeProductId: number; salesDate: string | Date; soldQty: string }>,
): Map<number, Map<string, string>> {
  const map = new Map<number, Map<string, string>>();
  for (const row of rows) {
    const dateKey = normalizeIsoDate(row.salesDate);
    if (!dateKey) continue;
    const byDate = map.get(row.storeProductId) ?? new Map<string, string>();
    byDate.set(dateKey, row.soldQty);
    map.set(row.storeProductId, byDate);
  }
  return map;
}

export function dailySalesForProductInRange(
  salesByProductAndDate: Map<number, Map<string, string>>,
  storeProductId: number,
  dates: string[],
): string[] {
  const byDate = salesByProductAndDate.get(storeProductId);
  return dates.map((date) => byDate?.get(date) ?? "0");
}

export function boundingIsoRange(
  ranges: Array<{ startDate: string; endDate: string }>,
): { startDate: string; endDate: string } | null {
  const valid = ranges.filter(
    (range) => range.startDate && range.endDate && range.endDate >= range.startDate,
  );
  if (!valid.length) return null;
  let startDate = valid[0]!.startDate;
  let endDate = valid[0]!.endDate;
  for (const range of valid) {
    if (range.startDate < startDate) startDate = range.startDate;
    if (range.endDate > endDate) endDate = range.endDate;
  }
  return { startDate, endDate };
}

export function sumQtyInDateRange(
  byDate: Map<string, string> | undefined,
  startDate: string,
  endDate: string,
): Decimal {
  let total = new Decimal(0);
  if (!byDate) return total;
  for (const [date, qty] of byDate) {
    if (date >= startDate && date <= endDate) {
      total = total.plus(toDecimal(qty));
    }
  }
  return total;
}

export function averageComparisonPeriodDays(
  periods: Array<{ startDate: string; endDate: string }>,
): number {
  if (!periods.length) return 0;
  const total = periods.reduce(
    (sum, period) => sum + diffDaysInclusive(period.startDate, period.endDate),
    0,
  );
  return total / periods.length;
}

export function totalUniquePeriodDays(
  periods: Array<{ startDate: string; endDate: string }>,
): number {
  const dates = new Set<string>();
  for (const period of periods) {
    for (const date of listDatesInclusive(period.startDate, period.endDate)) {
      dates.add(date);
    }
  }
  return dates.size;
}

export function aggregatePeriodSales(
  values: Decimal[],
  method: SoldQtyMethod,
): Decimal {
  if (!values.length) return new Decimal(0);
  if (method === "max") {
    return values.reduce((max, value) => Decimal.max(max, value), values[0]!);
  }
  if (method === "min") {
    return values.reduce((min, value) => Decimal.min(min, value), values[0]!);
  }
  const sum = values.reduce((acc, value) => acc.plus(value), new Decimal(0));
  return sum.div(values.length);
}

export function scaleSoldQtyForShortfall(input: {
  baseSoldQty: Decimal;
  comparisonPeriodDays: number;
  shortfallDays: number;
}): Decimal {
  const { baseSoldQty, comparisonPeriodDays, shortfallDays } = input;
  if (shortfallDays <= 0 || comparisonPeriodDays <= 0) {
    return baseSoldQty;
  }
  if (shortfallDays === comparisonPeriodDays) {
    return baseSoldQty;
  }
  const daily = baseSoldQty.div(comparisonPeriodDays);
  return daily.mul(shortfallDays);
}

export type OrderSheetSuggestedQtyInput = {
  requiredQuantityForShortfall: Decimal;
  currentStock: Decimal;
  wastageQty: Decimal;
  rtcQty: Decimal;
  includeWastage: boolean;
  includeRtc: boolean;
};

/** Isolated formula for order sheet suggested quantity. */
export function calculateOrderSheetSuggestedQty(
  input: OrderSheetSuggestedQtyInput,
): Decimal {
  let adjustments = new Decimal(0);
  if (input.includeWastage) {
    adjustments = adjustments.plus(input.wastageQty);
  }
  if (input.includeRtc) {
    adjustments = adjustments.plus(input.rtcQty);
  }

  const raw = input.requiredQuantityForShortfall
    .minus(input.currentStock)
    .plus(adjustments);

  return Decimal.max(raw, new Decimal(0));
}

export function roundOrderQty(value: Decimal): Decimal {
  return toDecimal(value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
}

export function parseQty(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") {
    return new Decimal(0);
  }
  try {
    return toDecimal(String(value));
  } catch {
    return new Decimal(0);
  }
}
