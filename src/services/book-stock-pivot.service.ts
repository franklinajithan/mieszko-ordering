import type { ParsedRow } from "@/types";
import { toDecimal } from "@/utils/decimal";

export function pivotBookStockByReference(
  rows: ParsedRow[],
  referenceColumn: string,
  quantityColumn: string,
): { rows: ParsedRow[]; duplicateRows: number; sourceRows: number } {
  const aggregated = new Map<
    string,
    { quantity: ReturnType<typeof toDecimal>; sourceCount: number }
  >();

  for (const row of rows) {
    const reference = row[referenceColumn]?.trim() ?? "";
    if (!reference) continue;

    const qtyRaw = row[quantityColumn]?.trim() ?? "";
    if (!qtyRaw) continue;

    let quantity;
    try {
      quantity = toDecimal(qtyRaw);
      if (!quantity.isFinite()) continue;
    } catch {
      continue;
    }

    const existing = aggregated.get(reference);
    if (existing) {
      existing.quantity = existing.quantity.plus(quantity);
      existing.sourceCount += 1;
    } else {
      aggregated.set(reference, { quantity, sourceCount: 1 });
    }
  }

  const duplicateRows = [...aggregated.values()].reduce(
    (sum, entry) => sum + Math.max(0, entry.sourceCount - 1),
    0,
  );

  const pivotedRows: ParsedRow[] = [...aggregated.entries()].map(
    ([reference, entry], index) => ({
      [referenceColumn]: reference,
      [quantityColumn]: entry.quantity.toString(),
      __rowNumber: String(index + 2),
    }),
  );

  return {
    rows: pivotedRows,
    duplicateRows,
    sourceRows: rows.length,
  };
}
