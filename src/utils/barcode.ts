/** Barcode strings to try when matching catalog barcodes (EAN/GTIN variants). */
export function barcodeLookupCandidates(barcode: string): string[] {
  const trimmed = barcode.trim();
  const digits = trimmed.replace(/\D/g, "");
  const out = new Set<string>();
  if (trimmed) out.add(trimmed);
  if (!digits) return [...out];

  out.add(digits);
  if (digits.length === 12) out.add(digits.padStart(13, "0"));
  if (digits.length === 13 && digits.startsWith("0")) out.add(digits.replace(/^0+/, "") || digits);
  if (digits.length < 13 && digits.length >= 6) out.add(digits.padStart(13, "0"));

  return [...out];
}

export function formatSpreadsheetBarcode(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
      return String(value);
    }
    const truncated = Math.trunc(value);
    if (Number.isFinite(truncated) && Math.abs(truncated) <= Number.MAX_SAFE_INTEGER) {
      return String(truncated);
    }
    return String(value).trim();
  }
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && Math.abs(asNumber) <= Number.MAX_SAFE_INTEGER) {
      return String(Math.trunc(asNumber));
    }
  }
  return trimmed;
}
