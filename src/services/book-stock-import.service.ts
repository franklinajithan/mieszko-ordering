import { db } from "@/db";
import type { ImportResult, ParsedRow } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import { bookStockRepository, productRepository } from "@/repositories";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import type { ErpType } from "@/types";

export async function importBookStockRows(input: {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  rows: ParsedRow[];
  erpType?: ErpType;
}): Promise<ImportResult & { importId: number }> {
  let rows = input.rows;
  let duplicateRows = 0;

  if (input.erpType === "glopos") {
    const pivoted = pivotBookStockByReference(
      rows,
      input.referenceColumn,
      input.quantityColumn,
    );
    rows = pivoted.rows;
    duplicateRows = pivoted.duplicateRows;
  }

  const result: ImportResult = {
    totalRows: rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows,
    errors: [],
  };

  let importId = 0;

  await db.transaction(async () => {
    const bookStockImport = await bookStockRepository.createImport({
      storeId: input.storeId,
      bookStockDate: input.bookStockDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = bookStockImport.id;

    const validRows: Array<{
      importId: number;
      storeProductId: number;
      storeProductCode: string;
      quantity: string;
    }> = [];

    for (const row of rows) {
      const rowNumber = Number(row.__rowNumber ?? 0);
      const reference = row[input.referenceColumn]?.trim() ?? "";
      const qtyRaw = row[input.quantityColumn]?.trim() ?? "";

      if (!reference) {
        result.invalidRows += 1;
        result.errors.push({
          rowNumber,
          reference: null,
          message: "Missing product code",
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

      const storeProduct = await productRepository.findStoreProductByCode(
        input.storeId,
        reference,
      );

      if (!storeProduct) {
        result.unmatchedRows += 1;
        result.errors.push({
          rowNumber,
          reference,
          message: "No matching store product",
        });
        continue;
      }

      validRows.push({
        importId: bookStockImport.id,
        storeProductId: storeProduct.id,
        storeProductCode: reference,
        quantity: decimalToDb(qty),
      });
      result.matchedRows += 1;
    }

    if (validRows.length) {
      await bookStockRepository.insertItems(validRows);
    }
  });

  return { ...result, importId };
}
