import Decimal from "decimal.js";
export { Decimal };

export function toDecimal(value: string | number | Decimal | null | undefined): Decimal {
  if (value instanceof Decimal) return value;
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value);
}

export function decimalMax(...values: Decimal[]): Decimal {
  if (values.length === 0) return new Decimal(0);
  return Decimal.max(...values);
}

export function formatDecimal(value: Decimal | string | number, places = 2): string {
  return toDecimal(value).toFixed(places);
}

export function decimalToDb(value: Decimal): string {
  return value.toFixed(4);
}

export function parseDbDecimal(value: string | null | undefined): Decimal {
  return toDecimal(value ?? 0);
}
