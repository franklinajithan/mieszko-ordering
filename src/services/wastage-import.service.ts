import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow, SalesMappingType } from "@/types";
import {
  storeWastageRepository,
  wastageRepository,
} from "@/repositories/postgres";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { importStoreQuantityRows } from "@/services/store-quantity-import.service";

export async function importWastageRows(input: {
  storeId: number;
  wastageDate: string;
  mappingType: SalesMappingType;
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

  let importId = 0;
  let result: ImportResult = {
    totalRows: rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows,
    errors: [],
  };

  await db.transaction(async () => {
    const wastageImport = await wastageRepository.createImport({
      storeId: input.storeId,
      wastageDate: input.wastageDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = wastageImport.id;

    result = await importStoreQuantityRows({
      storeId: input.storeId,
      mappingType: input.mappingType,
      productColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
      recordDate: input.wastageDate,
      rows,
      upsert: async ({ storeProductId, quantity }) => {
        await storeWastageRepository.upsert({
          storeProductId,
          wastageDate: input.wastageDate,
          wastageQty: quantity,
        });
      },
    });

    result.duplicateRows = (result.duplicateRows ?? 0) + duplicateRows;
    await wastageRepository.updateMatchedRows(importId, result.matchedRows);
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
  return imports.map((entry) => ({
    importId: entry.id,
    fileName: entry.fileName,
    wastageDate: entry.wastageDate,
    importedAt: entry.importedAt,
    itemCount: entry.matchedRows ?? 0,
  }));
}
