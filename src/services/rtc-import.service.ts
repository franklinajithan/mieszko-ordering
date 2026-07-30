import { db } from "@/db";
import type { ErpType, ImportResult, ParsedRow, SalesMappingType } from "@/types";
import { toDecimal, decimalToDb, type Decimal } from "@/utils/decimal";
import { barcodeLookupCandidates, formatSpreadsheetBarcode } from "@/utils/barcode";
import {
  productRepository,
  rtcRepository,
  rtcSalesRepository,
} from "@/repositories/postgres";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import type { GloposRtcHistoryParseResult } from "@/parsers/glopos-rtc-history-parser";

export const RTC_IMPORT_BATCH_SIZE = 50;
export const RTC_ITEM_CODE_COLUMN = "Item Code";

export type PreparedRtcRow = {
  reference: string;
  qty: Decimal;
  rowNumber: number;
  productName?: string | null;
};

export function prepareRtcImport(input: {
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
}): { rows: PreparedRtcRow[]; result: ImportResult } {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  const pending = new Map<string, PreparedRtcRow>();

  for (const row of input.rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const reference = row[input.referenceColumn]?.trim() ?? "";
    const qtyRaw = row[input.quantityColumn]?.trim() ?? "";
    const productName =
      row.__productName?.trim() ??
      row["Sale Description"]?.trim() ??
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

/** Resolve file barcodes to store item codes before RTC import (catalog join). */
export async function enrichGloposRtcRowsWithStoreProductCodes(
  storeId: number,
  gloposRtc: GloposRtcHistoryParseResult,
): Promise<{
  rows: ParsedRow[];
  matchedCount: number;
  unmatchedBarcodes: string[];
}> {
  const barcodeColumn = gloposRtc.barcodeColumn;
  const quantityColumn = gloposRtc.quantityColumn;
  const fileBarcodes = gloposRtc.rows.map((row) =>
    formatSpreadsheetBarcode(row[barcodeColumn]).trim(),
  );
  const matches = await productRepository.findStoreProductMatchesForFileBarcodes(
    storeId,
    fileBarcodes,
  );
  const byFileBarcode = new Map(matches.map((m) => [m.fileBarcode, m]));

  const byStoreProductCode = new Map<string, ParsedRow>();
  const unmatchedBarcodes: string[] = [];

  for (const row of gloposRtc.rows) {
    const barcode = formatSpreadsheetBarcode(row[barcodeColumn]).trim();
    const match = byFileBarcode.get(barcode);
    if (!match) {
      if (barcode) unmatchedBarcodes.push(barcode);
      continue;
    }

    const qtyRaw = row[quantityColumn]?.trim() ?? "";
    const code = match.storeProductCode;
    const existing = byStoreProductCode.get(code);
    if (existing) {
      try {
        const sum = toDecimal(existing[quantityColumn] ?? "0").plus(toDecimal(qtyRaw));
        existing[quantityColumn] = sum.toString();
      } catch {
        existing[quantityColumn] = qtyRaw;
      }
      continue;
    }

    byStoreProductCode.set(code, {
      [RTC_ITEM_CODE_COLUMN]: code,
      [quantityColumn]: qtyRaw,
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

export async function buildGloposRtcPreviewWithStoreProductCodes(
  storeId: number,
  gloposRtc: GloposRtcHistoryParseResult,
) {
  const barcodeColumn = gloposRtc.barcodeColumn;
  const quantityColumn = gloposRtc.quantityColumn;
  const fileBarcodes = gloposRtc.rows.map((row) =>
    formatSpreadsheetBarcode(row[barcodeColumn]).trim(),
  );
  const matches = await productRepository.findStoreProductMatchesForFileBarcodes(
    storeId,
    fileBarcodes,
  );
  const byFileBarcode = new Map(matches.map((m) => [m.fileBarcode, m]));

  const rows = gloposRtc.rows.map((row) => {
    const barcode = formatSpreadsheetBarcode(row[barcodeColumn]).trim();
    const match = byFileBarcode.get(barcode);
    return {
      [RTC_ITEM_CODE_COLUMN]: match?.storeProductCode ?? "",
      [barcodeColumn]: barcode,
      [quantityColumn]: row[quantityColumn] ?? "",
    };
  });

  const uniqueFileBarcodes = [...new Set(fileBarcodes.filter(Boolean))];
  const matchedBarcodes = new Set(matches.map((m) => m.fileBarcode));
  const unmatchedBarcodes = uniqueFileBarcodes.filter((b) => !matchedBarcodes.has(b));

  return {
    headers: [RTC_ITEM_CODE_COLUMN, barcodeColumn, quantityColumn],
    rows,
    referenceColumn: RTC_ITEM_CODE_COLUMN,
    quantityColumn,
    mappingType: "store_product_code" as const,
    rtcDate: gloposRtc.rtcDate ?? undefined,
    duplicateRows: gloposRtc.duplicateRows,
    matchedCount: matchedBarcodes.size,
    unmatchedCount: unmatchedBarcodes.length,
    unmatchedBarcodes: unmatchedBarcodes.slice(0, 15),
  };
}

export async function resolvePreparedRtcRowsFromBarcodesToStoreProductCodes(
  storeId: number,
  prepared: { rows: PreparedRtcRow[]; result: ImportResult },
): Promise<{ rows: PreparedRtcRow[]; result: ImportResult }> {
  const barcodes = prepared.rows.map((row) =>
    formatSpreadsheetBarcode(row.reference).trim(),
  );
  const matches = await productRepository.findStoreProductMatchesForFileBarcodes(
    storeId,
    barcodes,
  );
  const byFileBarcode = new Map(matches.map((m) => [m.fileBarcode, m]));

  const byStoreProductCode = new Map<string, PreparedRtcRow>();

  for (const row of prepared.rows) {
    const fileBarcode = formatSpreadsheetBarcode(row.reference).trim();
    const match = byFileBarcode.get(fileBarcode);
    if (!match) {
      prepared.result.unmatchedRows += 1;
      if (prepared.result.errors.length < 25) {
        prepared.result.errors.push({
          rowNumber: row.rowNumber,
          reference: row.reference,
          message: `No store product for barcode ${fileBarcode}. Link the barcode on the catalog product.`,
        });
      }
      continue;
    }

    const code = match.storeProductCode;
    const existing = byStoreProductCode.get(code);
    if (existing) {
      existing.qty = existing.qty.plus(row.qty);
      continue;
    }

    byStoreProductCode.set(code, {
      reference: code,
      qty: row.qty,
      rowNumber: row.rowNumber,
      productName: row.productName ?? match.productName,
    });
  }

  return { rows: [...byStoreProductCode.values()], result: prepared.result };
}

async function resolveStoreProductIds(
  storeId: number,
  mappingType: SalesMappingType,
  references: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!references.length) return map;

  if (mappingType === "store_product_code") {
    const products = await productRepository.findStoreProductsByCodes(storeId, references);
    for (const product of products) {
      map.set(product.storeProductCode, product.id);
    }
    return map;
  }

  const allCandidates = new Set<string>();
  const refCandidates = new Map<string, string[]>();
  for (const ref of references) {
    const candidates = barcodeLookupCandidates(ref);
    refCandidates.set(ref, candidates);
    for (const candidate of candidates) allCandidates.add(candidate);
  }

  const catalogRows = await productRepository.findStoreProductsByBarcodes(
    storeId,
    [...allCandidates],
  );
  const catalogToStoreProduct = new Map<string, number>();
  for (const row of catalogRows) {
    catalogToStoreProduct.set(row.barcode, row.storeProduct.id);
  }

  for (const ref of references) {
    for (const candidate of refCandidates.get(ref) ?? []) {
      const storeProductId = catalogToStoreProduct.get(candidate);
      if (storeProductId) {
        map.set(ref, storeProductId);
        break;
      }
    }
  }

  return map;
}

export async function importRtcQuantityBatch(input: {
  storeId: number;
  rtcDate: string;
  mappingType: SalesMappingType;
  rows: PreparedRtcRow[];
  result: ImportResult;
}) {
  if (!input.rows.length) return;

  const references = [...new Set(input.rows.map((row) => row.reference))];
  const storeProductByReference = await resolveStoreProductIds(
    input.storeId,
    input.mappingType,
    references,
  );

  const toUpsert: Array<{
    storeProductId: number;
    rtcDate: string;
    rtcQty: string;
  }> = [];

  for (const row of input.rows) {
    const storeProductId = storeProductByReference.get(row.reference);
    if (!storeProductId) {
      input.result.unmatchedRows += 1;
      if (input.result.errors.length < 25) {
        input.result.errors.push({
          rowNumber: row.rowNumber,
          reference: row.reference,
          message: `No matching store product. ${row.productName ? `Name: ${row.productName}` : "Check barcode on catalog"}`,
        });
      }
      continue;
    }

    toUpsert.push({
      storeProductId,
      rtcDate: input.rtcDate,
      rtcQty: decimalToDb(row.qty),
    });
  }

  if (toUpsert.length) {
    await rtcSalesRepository.upsertBatch(toUpsert);
    input.result.matchedRows += toUpsert.length;
  }
}

export async function importRtcRows(input: {
  storeId: number;
  rtcDate: string;
  mappingType: SalesMappingType;
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
  erpType?: ErpType;
  skipReferencePivot?: boolean;
}): Promise<ImportResult & { importId: number }> {
  let rows = input.rows;
  let duplicateRows = 0;

  if (input.erpType === "glopos" && !input.skipReferencePivot) {
    const pivoted = pivotBookStockByReference(
      rows,
      input.referenceColumn,
      input.quantityColumn,
    );
    rows = pivoted.rows;
    duplicateRows = pivoted.duplicateRows;
  }

  const prepared = prepareRtcImport({
    referenceColumn: input.referenceColumn,
    quantityColumn: input.quantityColumn,
    rows,
  });
  prepared.result.duplicateRows = (prepared.result.duplicateRows ?? 0) + duplicateRows;

  let mappingType = input.mappingType;
  let importRows = prepared.rows;
  let referenceColumn = input.referenceColumn;
  if (input.skipReferencePivot && input.mappingType === "barcode") {
    const remapped = await resolvePreparedRtcRowsFromBarcodesToStoreProductCodes(
      input.storeId,
      prepared,
    );
    importRows = remapped.rows;
    prepared.result = remapped.result;
    mappingType = "store_product_code";
    referenceColumn = RTC_ITEM_CODE_COLUMN;
  }

  let importId = 0;

  await db.transaction(async () => {
    const rtcImport = await rtcRepository.createImport({
      storeId: input.storeId,
      rtcDate: input.rtcDate,
      referenceColumn,
      quantityColumn: input.quantityColumn,
    });
    importId = rtcImport.id;

    await importRtcQuantityBatch({
      storeId: input.storeId,
      rtcDate: input.rtcDate,
      mappingType,
      rows: importRows,
      result: prepared.result,
    });

    await rtcRepository.updateMatchedRows(importId, prepared.result.matchedRows);
  });

  return { ...prepared.result, importId };
}

export type RtcImportSummary = {
  importId: number;
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
    rtcDate: entry.rtcDate,
    importedAt: entry.importedAt,
    itemCount: entry.matchedRows ?? 0,
  }));
}
