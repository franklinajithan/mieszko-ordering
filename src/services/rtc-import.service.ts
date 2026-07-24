import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import { productRepository, rtcRepository } from "@/repositories/postgres";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";

export async function importRtcRows(input: {
  storeId: number;
  rtcDate: string;
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
    const rtcImport = await rtcRepository.createImport({
      storeId: input.storeId,
      rtcDate: input.rtcDate,
      fileName: input.fileName,
      referenceColumn: input.referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = rtcImport.id;

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
        importId: rtcImport.id,
        storeProductId: storeProduct.id,
        storeProductCode: reference,
        quantity: decimalToDb(qty),
      });
      result.matchedRows += 1;
    }

    if (validRows.length) {
      await rtcRepository.insertItems(validRows);
    }
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
  const summaries: RtcImportSummary[] = [];
  for (const entry of imports) {
    summaries.push({
      importId: entry.id,
      fileName: entry.fileName,
      rtcDate: entry.rtcDate,
      importedAt: entry.importedAt,
      itemCount: await rtcRepository.countItems(entry.id),
    });
  }
  return summaries;
}
