import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow, SalesMappingType } from "@/types";
import {
  rtcRepository,
  rtcSalesRepository,
} from "@/repositories/postgres";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { importStoreQuantityRows } from "@/services/store-quantity-import.service";

export async function importRtcRows(input: {
  storeId: number;
  rtcDate: string;
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
    const rtcImport = await rtcRepository.createImport({
      storeId: input.storeId,
      rtcDate: input.rtcDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = rtcImport.id;

    result = await importStoreQuantityRows({
      storeId: input.storeId,
      mappingType: input.mappingType,
      productColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
      recordDate: input.rtcDate,
      rows,
      upsert: async ({ storeProductId, quantity }) => {
        await rtcSalesRepository.upsert({
          storeProductId,
          rtcDate: input.rtcDate,
          rtcQty: quantity,
        });
      },
    });

    result.duplicateRows = (result.duplicateRows ?? 0) + duplicateRows;
    await rtcRepository.updateMatchedRows(importId, result.matchedRows);
  });

  return { ...result, importId };
}

export type RtcImportSummary = {
  importId: number;
  fileName: string | null;
  rtcDate: string;
  importedAt: Date;
  itemCount: number;
};

export async function listRtcImportsForStore(
  storeId: number,
): Promise<RtcImportSummary[]> {
  const imports = await rtcRepository.listForStore(storeId);
  return imports.map((entry) => ({
    importId: entry.id,
    fileName: entry.fileName,
    rtcDate: entry.rtcDate,
    importedAt: entry.importedAt,
    itemCount: entry.matchedRows ?? 0,
  }));
}
