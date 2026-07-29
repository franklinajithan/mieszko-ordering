/** Normalize a barcode from a spreadsheet cell for storage (no length rules). */
export function normalizeImportBarcode(value: unknown): string {
  return formatSpreadsheetBarcode(value).trim();
}

/** Barcode strings to try when matching catalog barcodes (EAN/GTIN variants). */
export function barcodeLookupCandidates(barcode: string): string[] {
  const trimmed = barcode.trim();
  const digits = trimmed.replace(/\D/g, "");
  const out = new Set<string>();
  if (trimmed) out.add(trimmed);
  if (!digits) return [...out];

  out.add(digits);
  // Optional GTIN variants for lookup only — stored barcodes are never padded or truncated.
  if (digits.length === 12) out.add(digits.padStart(13, "0"));
  if (digits.length === 13 && digits.startsWith("0")) {
    out.add(digits.replace(/^0+/, "") || digits);
  }

  return [...out];
}

export function formatSpreadsheetBarcode(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return String(Math.trunc(asNumber));
    }
  }
  return trimmed;
}
