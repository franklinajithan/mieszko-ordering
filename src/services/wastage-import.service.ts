import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import { productRepository, wastageRepository } from "@/repositories/postgres";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";

export async function importWastageRows(input: {
  storeId: number;
  wastageDate: string;
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
    const wastageImport = await wastageRepository.createImport({
      storeId: input.storeId,
      wastageDate: input.wastageDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = wastageImport.id;

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
        importId: wastageImport.id,
        storeProductId: storeProduct.id,
        storeProductCode: reference,
        quantity: decimalToDb(qty),
      });
      result.matchedRows += 1;
    }

    if (validRows.length) {
      await wastageRepository.insertItems(validRows);
    }
  });

  return { ...result, importId };
}

export type WastageImportSummary = {
  importId: number;
  fileName: string | null;
  wastageDate: string;
  importedAt: Date;
  itemCount: number;
};

export async function listWastageImportsForStore(
  storeId: number,
): Promise<WastageImportSummary[]> {
  const imports = await wastageRepository.listForStore(storeId);
  const summaries: WastageImportSummary[] = [];
  for (const entry of imports) {
    summaries.push({
      importId: entry.id,
      fileName: entry.fileName,
      wastageDate: entry.wastageDate,
      importedAt: entry.importedAt,
      itemCount: await wastageRepository.countItems(entry.id),
    });
  }
  return summaries;
}
