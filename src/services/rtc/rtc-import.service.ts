import {recordUnmatchedIdentifiers} from '@/services/operations/import-observations.service';
import type { FilePreview, ImportResult, ParsedRow, SalesMappingType } from "@/types";
import { decimalToDb } from "@/utils/decimal";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import { productRepository, rtcSalesRepository } from "@/repositories";
import type { GloposRtcHistoryParseResult } from "@/parsers/rtc/glopos-rtc-history-parser";
import { tryParseGloposRtcHistoryReport } from "@/parsers/rtc/glopos-rtc-history-parser";
import { parseUploadedFile } from "@/parsers/file-parser";
import { RTC_ITEM_CODE_COLUMN } from "@/lib/import-config";
import {
  assertStoreFileErpMatch,
  type ParseImportFileInput,
} from "@/services/import-parse.service";
import {
  prepareRtcImport,
  remapRtcBarcodeRowsToStoreProductCodes,
  type PreparedRtcRow,
} from "@/services/rtc/rtc-import-prepare";
import { detectRtcFileErpType } from "@/utils/erp-file-validation";

export { prepareRtcImport, RTC_ITEM_CODE_COLUMN };
export type { PreparedRtcRow };

export type RtcParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  rtcDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedBarcodes?: string[];
};

/** Inspect an RTC upload for UI column mapping (does not persist). */
export async function parseRtcImportFile(
  input: ParseImportFileInput,
): Promise<RtcParseResult> {
  const gloposRtc = await tryParseGloposRtcHistoryReport(
    input.buffer,
    input.fileName,
  );

  let preview: RtcParseResult;

  if (gloposRtc && input.storeId) {
    const enriched = await buildGloposRtcPreviewWithStoreProductCodes(
      input.storeId,
      gloposRtc,
    );
    preview = {
      ...enriched,
      rows: enriched.rows.slice(0, 10),
    };
  } else if (gloposRtc) {
    preview = {
      headers: gloposRtc.headers,
      rows: gloposRtc.rows.slice(0, 10),
      referenceColumn: gloposRtc.barcodeColumn,
      quantityColumn: gloposRtc.quantityColumn,
      rtcDate: gloposRtc.rtcDate ?? undefined,
      duplicateRows: gloposRtc.duplicateRows,
      mappingType: "barcode",
    };
  } else {
    preview = await parseUploadedFile(input.buffer, input.fileName);
  }

  await assertStoreFileErpMatch({
    storeId: input.storeId,
    headers: preview.headers,
    fileName: input.fileName,
    detectFileErpType: detectRtcFileErpType,
  });

  return preview;
}

export async function enrichGloposRtcRowsWithStoreProductCodes(
  storeId: number,
  gloposRtc: GloposRtcHistoryParseResult,
) {
  const fileBarcodes = gloposRtc.rows.map((row) =>
    formatSpreadsheetBarcode(row[gloposRtc.barcodeColumn]).trim(),
  );
  const matches = await productRepository.findStoreProductMatchesForFileBarcodes(
    storeId,
    fileBarcodes,
  );
  return remapRtcBarcodeRowsToStoreProductCodes({
    barcodeColumn: gloposRtc.barcodeColumn,
    quantityColumn: gloposRtc.quantityColumn,
    rows: gloposRtc.rows,
    matches,
  });
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
  const unmatchedBarcodes = uniqueFileBarcodes.filter(
    (b) => !matchedBarcodes.has(b),
  );
  await recordUnmatchedIdentifiers(storeId,'rtc','unmatched_barcode',unmatchedBarcodes);

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

export async function importRtcQuantityBatch(input: {
  storeId: number;
  rtcDate: string;
  rows: PreparedRtcRow[];
  result: ImportResult;
}) {
  if (!input.rows.length) return;

  const references = [...new Set(input.rows.map((row) => row.reference))];
  const products = await productRepository.findStoreProductsByCodes(
    input.storeId,
    references,
  );
  const storeProductByReference = new Map(
    products.map((product) => [product.storeProductCode, product.id]),
  );

  const toUpsert: Array<{
    storeProductId: number;
    rtcDate: string;
    rtcQty: string;
  }> = [];

  const unmatchedIdentifiers:string[]=[];
  for (const row of input.rows) {
    const storeProductId = storeProductByReference.get(row.reference);
    if (!storeProductId) {
      input.result.unmatchedRows += 1;
      unmatchedIdentifiers.push(row.reference);
      if (input.result.errors.length < 25) {
        input.result.errors.push({
          rowNumber: row.rowNumber,
          reference: row.reference,
          message: `No matching store product. ${
            row.productName ? `Name: ${row.productName}` : "Check item code"
          }`,
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

  await recordUnmatchedIdentifiers(input.storeId,'rtc','unknown_product_code',unmatchedIdentifiers);
  if (toUpsert.length) {
    await rtcSalesRepository.upsertBatch(toUpsert);
    input.result.matchedRows += toUpsert.length;
  }
}

/** Import RTC rows already keyed by store product code. */
export async function importRtcRows(input: {
  storeId: number;
  rtcDate: string;
  mappingType?: SalesMappingType;
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
}): Promise<ImportResult> {
  const prepared = prepareRtcImport({
    referenceColumn: input.referenceColumn,
    quantityColumn: input.quantityColumn,
    rows: input.rows,
  });

  await importRtcQuantityBatch({
    storeId: input.storeId,
    rtcDate: input.rtcDate,
    rows: prepared.rows,
    result: prepared.result,
  });

  return prepared.result;
}

export type RtcStoreSummary = {
  rtcDate: string;
  itemCount: number;
  totalRtcQty: string;
  lastUpdated: string;
};

export async function listRtcSummariesForStore(
  storeId: number,
): Promise<RtcStoreSummary[]> {
  const rows = await rtcSalesRepository.listDateSummariesForStore(storeId);
  return rows.map((row) => ({
    rtcDate: row.rtcDate,
    itemCount: row.itemCount,
    totalRtcQty: String(row.totalRtcQty),
    lastUpdated: String(row.lastUpdated),
  }));
}

export async function deleteRtcForStoreDate(
  storeId: number,
  rtcDate: string,
): Promise<void> {
  await rtcSalesRepository.deleteForStoreAndDate(storeId, rtcDate);
}
