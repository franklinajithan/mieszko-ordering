import type { ImportResult, ParsedRow } from "@/types";
import { toDecimal, type Decimal } from "@/utils/decimal";
import { normalizeProductCode } from "@/parsers/products/product-file-parser";

export type PreparedWastageRow = {
  reference: string;
  qty: Decimal;
  rowNumber: number;
  productName?: string | null;
};

/** Pure row prep — sum qty by store product code. Safe for browser and server. */
export function prepareWastageImport(input: {
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
}): { rows: PreparedWastageRow[]; result: ImportResult } {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const pending = new Map<string, PreparedWastageRow>();

  for (const row of input.rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const reference = normalizeProductCode(
      row[input.referenceColumn]?.trim() ?? "",
    );
    const qtyRaw = row[input.quantityColumn]?.trim() ?? "";
    const productName =
      row.__productName?.trim() ??
      row["Item Name"]?.trim() ??
      row.Description?.trim() ??
      null;

    if (!reference) {
      result.invalidRows += 1;
      if (result.errors.length < 25) {
        result.errors.push({
          rowNumber,
          reference: null,
          message: "Missing product reference",
        });
      }
      continue;
    }

    let qty;
    try {
      qty = toDecimal(qtyRaw);
      if (!qty.isFinite()) throw new Error("invalid");
    } catch {
      result.invalidRows += 1;
      if (result.errors.length < 25) {
        result.errors.push({
          rowNumber,
          reference,
          message: "Invalid quantity",
        });
      }
      continue;
    }

    const existing = pending.get(reference);
    if (existing) {
      existing.qty = existing.qty.plus(qty);
      result.duplicateRows = (result.duplicateRows ?? 0) + 1;
      continue;
    }
    pending.set(reference, { reference, qty, rowNumber, productName });
  }

  return { rows: [...pending.values()], result };
}
