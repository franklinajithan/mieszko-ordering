import type { ImportResult, ParsedRow, SalesMappingType } from "@/types";
import { toDecimal, decimalToDb, type Decimal } from "@/utils/decimal";
import { productRepository } from "@/repositories/postgres";

type PendingRow = {
  reference: string;
  qty: Decimal;
  rowNumber: number;
};

export async function importStoreQuantityRows(input: {
  storeId: number;
  mappingType: SalesMappingType;
  productColumn: string;
  quantityColumn: string;
  recordDate: string;
  rows: ParsedRow[];
  upsert: (data: {
    storeProductId: number;
    quantity: string;
  }) => Promise<unknown>;
}): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const pending = new Map<string, PendingRow>();

  for (const row of input.rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const reference = row[input.productColumn]?.trim() ?? "";
    const qtyRaw = row[input.quantityColumn]?.trim() ?? "";

    if (!reference) {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference: null,
        message: "Missing product reference",
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
        message: "Invalid quantity",
      });
      continue;
    }

    const dedupeKey = `${reference}|${input.recordDate}`;
    const existing = pending.get(dedupeKey);
    if (existing) {
      existing.qty = existing.qty.plus(qty);
      result.duplicateRows = (result.duplicateRows ?? 0) + 1;
      continue;
    }
    pending.set(dedupeKey, { reference, qty, rowNumber });
  }

  for (const { reference, qty, rowNumber } of pending.values()) {
    let storeProduct = null;
    if (input.mappingType === "store_product_code") {
      storeProduct = await productRepository.findStoreProductByCode(
        input.storeId,
        reference,
      );
    } else {
      storeProduct = await productRepository.findStoreProductByBarcode(
        input.storeId,
        reference,
      );
    }

    if (!storeProduct) {
      result.unmatchedRows += 1;
      result.errors.push({
        rowNumber,
        reference,
        message: "No matching store product",
      });
      continue;
    }

    await input.upsert({
      storeProductId: storeProduct.id,
      quantity: decimalToDb(qty),
    });

    result.matchedRows += 1;
  }

  return result;
}