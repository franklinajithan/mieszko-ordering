import { formatDecimal, parseDbDecimal } from "@/utils/decimal";

export function formatPriceStatus(status: string): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "check_missing_code":
      return "CHECK – Missing Code";
    case "check_missing_price":
      return "CHECK – Missing Price";
    case "check_invalid_price":
      return "CHECK – Invalid Price";
    default:
      return status;
  }
}

export function formatMoney(value: string | null): string {
  if (!value) return "—";
  return formatDecimal(parseDbDecimal(value), 2);
}
