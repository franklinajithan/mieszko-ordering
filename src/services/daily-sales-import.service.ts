import { db } from "@/db";
import type { ImportResult, ParsedRow, SalesMappingType } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import { dailySalesRepository, productRepository } from "@/repositories/postgres";

export async function importDailySalesRows(input: {
  storeId: number;
  mappingType: SalesMappingType;
  productColumn: string;
  quantityColumn: string;
  dateColumn?: string;
  manualSalesDate?: string;
  rows: ParsedRow[];
}): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const seen = new Set<string>();

  await db.transaction(async () => {
    for (const row of input.rows) {
      const rowNumber = Number(row.__rowNumber ?? 0);
      const reference = row[input.productColumn]?.trim() ?? "";
      const qtyRaw = row[input.quantityColumn]?.trim() ?? "";
      const salesDate =
        input.manualSalesDate ??
        (input.dateColumn ? row[input.dateColumn]?.trim() : "");

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

      const dedupeKey = `${reference}|${salesDate}`;
      if (seen.has(dedupeKey)) {
        result.duplicateRows = (result.duplicateRows ?? 0) + 1;
        result.errors.push({
          rowNumber,
          reference,
          message: "Duplicate row in upload",
        });
        continue;
      }
      seen.add(dedupeKey);

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

      await dailySalesRepository.upsertSale({
        storeProductId: storeProduct.id,
        salesDate,
        soldQty: decimalToDb(qty),
        rtcQty: null,
        promoQty: null,
      });

      result.matchedRows += 1;
    }
  });

  return result;
}
