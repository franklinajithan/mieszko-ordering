import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow, SalesMappingType } from "@/types";
import {
  promoRepository,
  promoSalesRepository,
} from "@/repositories/postgres";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { importStoreQuantityRows } from "@/services/store-quantity-import.service";

export async function importPromoRows(input: {
  storeId: number;
  promoDate: string;
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
    const promoImport = await promoRepository.createImport({
      storeId: input.storeId,
      promoDate: input.promoDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = promoImport.id;

    result = await importStoreQuantityRows({
      storeId: input.storeId,
      mappingType: input.mappingType,
      productColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
      recordDate: input.promoDate,
      rows,
      upsert: async ({ storeProductId, quantity }) => {
        await promoSalesRepository.upsert({
          storeProductId,
          promoDate: input.promoDate,
          promoQty: quantity,
        });
      },
    });

    result.duplicateRows = (result.duplicateRows ?? 0) + duplicateRows;
    await promoRepository.updateMatchedRows(importId, result.matchedRows);
  });

  return { ...result, importId };
}

export type PromoImportSummary = {
  importId: number;
  fileName: string | null;
  promoDate: string;
  importedAt: Date;
  itemCount: number;
};

export async function listPromoImportsForStore(
  storeId: number,
): Promise<PromoImportSummary[]> {
  const imports = await promoRepository.listForStore(storeId);
  return imports.map((entry) => ({
    importId: entry.id,
    fileName: entry.fileName,
    promoDate: entry.promoDate,
    importedAt: entry.importedAt,
    itemCount: entry.matchedRows ?? 0,
  }));
}
