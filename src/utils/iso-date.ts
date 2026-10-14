/** Calendar date in YYYY-MM-DD (no time component). */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDateString(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value);
}
