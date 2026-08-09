import type { ImportResult, ParsedRow } from "@/types";
import { toDecimal, type Decimal } from "@/utils/decimal";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import { normalizeProductCode } from "@/parsers/product-file-parser";
import { IMPORT_COLUMNS } from "@/lib/import-config";

export const PROMO_ITEM_CODE_COLUMN = IMPORT_COLUMNS.itemCode;

export type PreparedPromoRow = {
  reference: string;
  qty: Decimal;
  rowNumber: number;
  productName?: string | null;
};

export type PromoBarcodeMatch = {
  fileBarcode: string;
  storeProductCode: string;
  productName: string | null;
};

/** Pure row prep — sum qty by store product code. */
export function preparePromoImport(input: {
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
}): { rows: PreparedPromoRow[]; result: ImportResult } {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const pending = new Map<string, PreparedPromoRow>();

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

/** Map barcode rows → store product codes and sum qty per code. */
export function remapPromoBarcodeRowsToStoreProductCodes(input: {
  barcodeColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
  matches: PromoBarcodeMatch[];
}): {
  rows: ParsedRow[];
  matchedCount: number;
  unmatchedBarcodes: string[];
} {
  const byFileBarcode = new Map(
    input.matches.map((m) => [
      formatSpreadsheetBarcode(m.fileBarcode).trim(),
      m,
    ]),
  );
  const byStoreProductCode = new Map<string, ParsedRow>();
  const unmatchedBarcodes: string[] = [];

  for (const row of input.rows) {
    const barcode = formatSpreadsheetBarcode(row[input.barcodeColumn]).trim();
    const match = byFileBarcode.get(barcode);
    if (!match) {
      if (barcode) unmatchedBarcodes.push(barcode);
      continue;
    }

    const qtyRaw = row[input.quantityColumn]?.trim() ?? "";
    const code = match.storeProductCode;
    const existing = byStoreProductCode.get(code);
    if (existing) {
      try {
        const sum = toDecimal(existing[input.quantityColumn] ?? "0").plus(
          toDecimal(qtyRaw),
        );
        existing[input.quantityColumn] = sum.toString();
      } catch {
        existing[input.quantityColumn] = qtyRaw;
      }
      continue;
    }

    byStoreProductCode.set(code, {
      [PROMO_ITEM_CODE_COLUMN]: code,
      [input.quantityColumn]: qtyRaw,
      __productName: row.__productName ?? match.productName ?? undefined,
      __rowNumber: row.__rowNumber,
    });
  }

  return {
    rows: [...byStoreProductCode.values()],
    matchedCount: byStoreProductCode.size,
    unmatchedBarcodes: [...new Set(unmatchedBarcodes)],
  };
}
