import type { ImportResult, ParsedRow } from "@/types";
import { toDecimal, type Decimal } from "@/utils/decimal";

export type AggregatedDailySale = {
  reference: string;
  productName: string | null;
  salesDate: string;
  qty: Decimal;
  rowNumber: number;
};

function isSalesSummaryRow(reference: string): boolean {
  const normalized = reference.replace(/[:\s]+$/g, "").toLowerCase();
  return (
    normalized === "total" ||
    normalized === "grand total" ||
    normalized.endsWith(" - total")
  );
}

/** Pure row prep — safe for browser and server. */
export function prepareDailySalesImport(input: {
  productColumn: string;
  quantityColumn: string;
  dateColumn?: string;
  manualSalesDate?: string;
  rows: ParsedRow[];
}): {
  sales: AggregatedDailySale[];
  result: ImportResult;
} {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const aggregated = new Map<string, AggregatedDailySale>();

  for (const row of input.rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const reference = row[input.productColumn]?.trim() ?? "";
    const productName =
      row.__productName?.trim() ??
      row["Product Name"]?.trim() ??
      row.Description?.trim() ??
      row.Name?.trim() ??
      null;
    const qtyRaw = row[input.quantityColumn]?.trim() ?? "";
    const salesDate =
      input.manualSalesDate ??
      (input.dateColumn ? row[input.dateColumn]?.trim() : "");

    if (isSalesSummaryRow(reference)) {
      result.totalRows -= 1;
      continue;
    }

    if (!reference) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference: null,
        message: "Missing product reference",
      });
      continue;
    }

    if (!salesDate) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference,
        message: "Missing sales date",
      });
      continue;
    }

    let qty;
    try {
      qty = toDecimal(qtyRaw);
      if (!qty.isFinite()) throw new Error("invalid");
    } catch {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference,
        message: "Invalid sold quantity",
      });
      continue;
    }

    const dedupeKey = `${reference.toLowerCase()}|${salesDate}`;
    const existing = aggregated.get(dedupeKey);
    if (existing) {
      existing.qty = existing.qty.plus(qty);
      result.duplicateRows = (result.duplicateRows ?? 0) + 1;
      continue;
    }

    aggregated.set(dedupeKey, {
      reference,
      productName,
      salesDate,
      qty,
      rowNumber,
    });
  }

  return { sales: [...aggregated.values()], result };
}
