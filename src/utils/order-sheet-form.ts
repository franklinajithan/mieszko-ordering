import type {
  ComparisonPeriod,
  OrderSheetFormState,
} from "@/types/orderSheet";
import {
  listDatesInclusive,
  MAX_DAY_BY_SALES_DAYS,
} from "@/utils/orderSheetCalculations";

export const DEFAULT_ORDER_SHEET_SUPPLIER_CODES = ["MM", "SP", "WAB", "ADM"];

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function defaultComparisonPeriods(): ComparisonPeriod[] {
  const periods: ComparisonPeriod[] = [];
  for (let index = 2; index >= 0; index -= 1) {
    const end = new Date();
    end.setDate(end.getDate() - index * 7 - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    periods.push({
      id: `comparison-period-${periods.length + 1}`,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
  }
  return periods;
}

export function defaultShortfallPeriods(): ComparisonPeriod[] {
  return [
    {
      id: "shortfall-period-1",
      startDate: todayIso(),
      endDate: addDaysIso(todayIso(), 6),
    },
  ];
}

export function createInitialOrderSheetForm(): OrderSheetFormState {
  return {
    storeIds: [],
    orderDate: todayIso(),
    deliveryDate: addDaysIso(todayIso(), 7),
    supplierIds: [],
    departmentIds: [],
    comparisonPeriods: defaultComparisonPeriods(),
    includeWastage: true,
    includeRtc: true,
    shortfallPeriods: defaultShortfallPeriods(),
    soldQtyMethod: "average",
    comment: "",
    dayBySalesRequired: false,
    dayBySalesStartDate: addDaysIso(todayIso(), -6),
    dayBySalesEndDate: todayIso(),
  };
}

export function createComparisonPeriod(existing: ComparisonPeriod[]): ComparisonPeriod {
  return createDatedPeriod(existing, "comparison-period", addDaysIso(todayIso(), -7), addDaysIso(todayIso(), -1));
}

export function createShortfallPeriod(existing: ComparisonPeriod[]): ComparisonPeriod {
  return createDatedPeriod(existing, "shortfall-period", todayIso(), addDaysIso(todayIso(), 6));
}

function createDatedPeriod(
  existing: ComparisonPeriod[],
  prefix: string,
  startDate: string,
  endDate: string,
): ComparisonPeriod {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const max = existing.reduce((acc, period) => {
    const match = period.id.match(new RegExp(`^${escaped}-(\\d+)$`));
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return {
    id: `${prefix}-${max + 1}`,
    startDate,
    endDate,
  };
}

export function getDayBySalesDates(form: OrderSheetFormState): string[] {
  if (!form.dayBySalesRequired) return [];
  if (!form.dayBySalesStartDate || !form.dayBySalesEndDate) return [];
  if (form.dayBySalesEndDate < form.dayBySalesStartDate) return [];
  return listDatesInclusive(form.dayBySalesStartDate, form.dayBySalesEndDate);
}

export function validateOrderSheetForm(
  form: OrderSheetFormState,
  dayBySalesDates: string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.storeIds.length) errors.storeIds = "Select at least one store";
  if (!form.orderDate) errors.orderDate = "Order date is required";
  if (!form.deliveryDate) errors.deliveryDate = "Delivery date is required";
  if (form.deliveryDate < form.orderDate) {
    errors.deliveryDate = "Delivery date cannot be earlier than order date";
  }
  if (!form.supplierIds.length) errors.supplierIds = "Select at least one supplier";
  if (!form.departmentIds.length) {
    errors.departmentIds = "Select at least one department";
  }
  if (!form.comparisonPeriods.length) {
    errors.comparisonPeriods = "Add at least one comparison period";
  }
  for (const [index, period] of form.comparisonPeriods.entries()) {
    if (period.endDate < period.startDate) {
      errors[`period-${index}`] = "End date cannot be before start date";
    }
  }
  if (!form.shortfallPeriods.length) {
    errors.shortfallPeriods = "Add at least one shortfall period";
  }
  for (const [index, period] of form.shortfallPeriods.entries()) {
    if (period.endDate < period.startDate) {
      errors[`shortfall-${index}`] = "End date cannot be before start date";
    }
  }
  if (form.dayBySalesRequired) {
    if (!form.dayBySalesStartDate) {
      errors.dayBySalesStartDate = "Start date is required";
    }
    if (!form.dayBySalesEndDate) {
      errors.dayBySalesEndDate = "End date is required";
    }
    if (
      form.dayBySalesStartDate &&
      form.dayBySalesEndDate &&
      form.dayBySalesEndDate < form.dayBySalesStartDate
    ) {
      errors.dayBySalesEndDate = "End date cannot be before start date";
    }
    if (dayBySalesDates.length > MAX_DAY_BY_SALES_DAYS) {
      errors.dayBySalesEndDate =
        `Range cannot exceed ${MAX_DAY_BY_SALES_DAYS} days`;
    }
  }
  return errors;
}

export function formatOrderSheetDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
