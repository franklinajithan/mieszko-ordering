import type {
  FilePreview,
  ImportResult,
  ParsedRow,
  SalesMappingType,
} from "@/types";
import { decimalToDb } from "@/utils/decimal";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import { normalizeProductCode } from "@/parsers/product-file-parser";
import {
  productRepository,
  storeRepository,
  wastageRepository,
} from "@/repositories";
import {
  assertStoreFileErpMatch,
  type ParseImportFileInput,
} from "@/services/import-parse.service";
import {
  prepareWastageImport,
  type PreparedWastageRow,
} from "@/services/wastage-import-prepare";
import type { GloposWastageReportParseResult } from "@/parsers/glopos-wastage-report-parser";
import {
  tryParseGloposWastageReport,
  WASTAGE_BARCODE_COLUMN,
  WASTAGE_PRODUCT_CODE_COLUMN,
  WASTAGE_QTY_COLUMN,
} from "@/parsers/glopos-wastage-report-parser";
import {
  tryParseGloposStockVarianceWastageReport,
  type GloposStockVarianceWastageParseResult,
} from "@/parsers/glopos-stock-variance-wastage-parser";
import { tryParseMspStockAdjustmentReport } from "@/parsers/msp-stock-adjustment-parser";
import { detectWastageColumns, parseUploadedFile } from "@/parsers/file-parser";
import {
  detectWastageFileErpType,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";
import {
  WASTAGE_ITEM_CODE_COLUMN,
} from "@/lib/import-config";
import { remapRtcBarcodeRowsToStoreProductCodes } from "@/services/rtc-import-prepare";

export { prepareWastageImport, WASTAGE_ITEM_CODE_COLUMN };
export type { PreparedWastageRow };

function catalogCodeKey(code: string): string {
  return normalizeProductCode(code).toLowerCase();
}

export type WastageParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  wastageDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  skippedExcludedReasonRows?: number;
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedCodes?: string[];
};

/** Map stock-variance barcode rows → store product codes for preview/import. */
export async function buildStockVarianceWastagePreviewWithStoreProductCodes(
  storeId: number,
  parsed: GloposStockVarianceWastageParseResult,
) {
  const fileBarcodes = parsed.rows.map((row) =>
    formatSpreadsheetBarcode(row[parsed.barcodeColumn] ?? "").trim(),
  );
  const matches =
    await productRepository.findStoreProductMatchesForFileBarcodes(
      storeId,
      fileBarcodes,
    );
  const remapped = remapRtcBarcodeRowsToStoreProductCodes({
    barcodeColumn: parsed.barcodeColumn,
    quantityColumn: parsed.quantityColumn,
    rows: parsed.rows,
    matches: matches.map((m) => ({
      fileBarcode: m.fileBarcode,
      storeProductCode: m.storeProductCode,
      productName: m.productName,
    })),
  });
  const byFileBarcode = new Map(matches.map((m) => [m.fileBarcode, m]));
  const uniqueFileBarcodes = [...new Set(fileBarcodes.filter(Boolean))];
  const matchedBarcodes = new Set(matches.map((m) => m.fileBarcode));
  const unmatchedBarcodes = uniqueFileBarcodes.filter(
    (b) => !matchedBarcodes.has(b),
  );

  const previewRows = remapped.rows.slice(0, 10).map((row) => {
    const code = row[WASTAGE_ITEM_CODE_COLUMN] ?? "";
    const match = [...byFileBarcode.values()].find(
      (m) => m.storeProductCode === code,
    );
    return {
      [WASTAGE_ITEM_CODE_COLUMN]: code,
      [parsed.barcodeColumn]: match?.fileBarcode ?? "",
      [parsed.quantityColumn]: row[parsed.quantityColumn] ?? "",
    };
  });

  return {
    headers: [
      WASTAGE_ITEM_CODE_COLUMN,
      parsed.barcodeColumn,
      parsed.quantityColumn,
    ],
    rows: previewRows,
    referenceColumn: WASTAGE_ITEM_CODE_COLUMN,
    quantityColumn: parsed.quantityColumn,
    mappingType: "barcode" as const,
    wastageDate: parsed.wastageDate ?? undefined,
    duplicateRows: parsed.duplicateRows,
    matchedCount: remapped.matchedCount,
    unmatchedCount: unmatchedBarcodes.length,
    unmatchedCodes: unmatchedBarcodes.slice(0, 15),
  };
}

/** Inspect a wastage upload for UI column mapping (does not persist). */
export async function parseWastageImportFile(
  input: ParseImportFileInput,
): Promise<WastageParseResult> {
  if (/rtc|price\s*override/i.test(input.fileName)) {
    throw new Error(
      "This looks like an RTC / Price Override file. Use the RTC import page for that report, or upload an MSP Stock Adjustment / GloPOS WastageReport.",
    );
  }

  const stockVariance = await tryParseGloposStockVarianceWastageReport(
    input.buffer,
    input.fileName,
  );
  if (stockVariance) {
    let preview: WastageParseResult = {
      headers: stockVariance.headers,
      rows: stockVariance.rows.slice(0, 10),
      referenceColumn: stockVariance.barcodeColumn,
      quantityColumn: stockVariance.quantityColumn,
      wastageDate: stockVariance.wastageDate ?? undefined,
      duplicateRows: stockVariance.duplicateRows,
      mappingType: "barcode",
    };
    if (input.storeId) {
      const enriched = await buildStockVarianceWastagePreviewWithStoreProductCodes(
        input.storeId,
        stockVariance,
      );
      preview = {
        ...enriched,
        rows: enriched.rows.slice(0, 10),
      };
    }
    await assertStoreFileErpMatch({
      storeId: input.storeId,
      headers: preview.headers,
      fileName: input.fileName,
      detectFileErpType: detectWastageFileErpType,
    });
    return preview;
  }

  const gloposWastage = await tryParseGloposWastageReport(
    input.buffer,
    input.fileName,
  );

  if (gloposWastage) {
    let preview: WastageParseResult = {
      headers: gloposWastage.headers,
      rows: gloposWastage.rows.slice(0, 10),
      referenceColumn: gloposWastage.productCodeColumn,
      quantityColumn: gloposWastage.quantityColumn,
      wastageDate: gloposWastage.wastageDate ?? undefined,
      duplicateRows: gloposWastage.duplicateRows,
      mappingType: "store_product_code",
      skippedExcludedReasonRows: gloposWastage.skippedExcludedReasonRows,
    };
    if (input.storeId) {
      const enriched = await buildGloposWastagePreviewWithStoreProductCodes(
        input.storeId,
        gloposWastage,
      );
      preview = {
        ...enriched,
        rows: enriched.rows.slice(0, 10),
        skippedExcludedReasonRows: gloposWastage.skippedExcludedReasonRows,
      };
    }
    await assertStoreFileErpMatch({
      storeId: input.storeId,
      headers: preview.headers,
      fileName: input.fileName,
      detectFileErpType: detectWastageFileErpType,
    });
    return preview;
  }

  const msp = await tryParseMspStockAdjustmentReport(
    input.buffer,
    input.fileName,
  );
  if (msp) {
    const preview: WastageParseResult = {
      headers: msp.headers,
      rows: msp.rows.slice(0, 10),
      referenceColumn: msp.itemCodeColumn,
      quantityColumn: msp.quantityColumn,
      wastageDate: msp.wastageDate ?? undefined,
      duplicateRows: msp.duplicateRows,
      mappingType: "store_product_code",
    };
    await assertStoreFileErpMatch({
      storeId: input.storeId,
      headers: preview.headers,
      fileName: input.fileName,
      detectFileErpType: detectWastageFileErpType,
    });
    return preview;
  }

  let preview: WastageParseResult = await parseUploadedFile(
    input.buffer,
    input.fileName,
  );
  if (input.storeId) {
    const store = await storeRepository.getById(input.storeId);
    if (store) {
      const detected = detectWastageColumns(
        preview.headers,
        resolveStoreErpType(store.erpType),
      );
      preview = {
        ...preview,
        referenceColumn: detected.referenceColumn ?? undefined,
        quantityColumn: detected.quantityColumn ?? undefined,
      };
    }
  }

  await assertStoreFileErpMatch({
    storeId: input.storeId,
    headers: preview.headers,
    fileName: input.fileName,
    detectFileErpType: detectWastageFileErpType,
  });

  return preview;
}

/** Map GloPOS wastage file codes/barcodes to store catalog item codes. */
export async function enrichGloposWastageRowsWithStoreProductCodes(
  storeId: number,
  glopos: GloposWastageReportParseResult,
): Promise<{
  rows: ParsedRow[];
  matchedCount: number;
  unmatchedCodes: string[];
}> {
  const codeCol = glopos.productCodeColumn;
  const qtyCol = glopos.quantityColumn;

  const fileCodes = [
    ...new Set(
      glopos.rows
        .map((row) => normalizeProductCode(row[codeCol] ?? ""))
        .filter(Boolean),
    ),
  ];

  const storeProducts = await productRepository.findStoreProductsByCodes(
    storeId,
    fileCodes,
  );
  const byCatalogCode = new Map<string, (typeof storeProducts)[number]>();
  for (const sp of storeProducts) {
    byCatalogCode.set(catalogCodeKey(sp.storeProductCode), sp);
  }

  const shortCodes = [
    ...new Set(
      glopos.rows
        .map((row) =>
          normalizeProductCode(
            formatSpreadsheetBarcode(row[WASTAGE_BARCODE_COLUMN] ?? "").trim(),
          ),
        )
        .filter((c) => c && !byCatalogCode.has(catalogCodeKey(c))),
    ),
  ];
  if (shortCodes.length) {
    const extra = await productRepository.findStoreProductsByCodes(
      storeId,
      shortCodes,
    );
    for (const sp of extra) {
      byCatalogCode.set(catalogCodeKey(sp.storeProductCode), sp);
    }
  }

  const barcodesForLookup = glopos.rows
    .map((row) =>
      formatSpreadsheetBarcode(row[WASTAGE_BARCODE_COLUMN] ?? "").trim(),
    )
    .filter(Boolean);
  const barcodeMatches =
    await productRepository.findStoreProductMatchesForFileBarcodes(
      storeId,
      barcodesForLookup,
    );
  const storeProductByFileBarcode = new Map(
    barcodeMatches.map((m) => [m.fileBarcode, m]),
  );

  const outRows: ParsedRow[] = [];
  const unmatchedCodes: string[] = [];

  for (const row of glopos.rows) {
    const fileCode = normalizeProductCode(row[codeCol] ?? "");
    const qty = row[qtyCol] ?? "";
    const fileBarcode = formatSpreadsheetBarcode(
      row[WASTAGE_BARCODE_COLUMN] ?? "",
    ).trim();

    let storeProductCode: string | null = null;

    const direct = fileCode
      ? byCatalogCode.get(catalogCodeKey(fileCode))
      : undefined;
    if (direct) storeProductCode = direct.storeProductCode;

    if (!storeProductCode && fileBarcode) {
      const asCode = normalizeProductCode(fileBarcode);
      const fromShortCode = asCode
        ? byCatalogCode.get(catalogCodeKey(asCode))
        : undefined;
      if (fromShortCode) storeProductCode = fromShortCode.storeProductCode;
    }

    if (!storeProductCode && fileBarcode) {
      const match = storeProductByFileBarcode.get(fileBarcode);
      if (match) storeProductCode = match.storeProductCode;
    }

    if (!storeProductCode) {
      if (fileCode) unmatchedCodes.push(fileCode);
      continue;
    }

    outRows.push({
      [codeCol]: storeProductCode,
      [qtyCol]: qty,
      __productName: row.__productName,
      __rowNumber: row.__rowNumber,
    });
  }

  const aggregated = new Map<string, ParsedRow>();
  for (const row of outRows) {
    const code = row[codeCol] ?? "";
    const existing = aggregated.get(code);
    if (!existing) {
      aggregated.set(code, { ...row });
      continue;
    }
    const sum = Number(existing[qtyCol] ?? 0) + Number(row[qtyCol] ?? 0);
    existing[qtyCol] = String(sum);
  }

  return {
    rows: [...aggregated.values()],
    matchedCount: aggregated.size,
    unmatchedCodes: [...new Set(unmatchedCodes)],
  };
}

export async function buildGloposWastagePreviewWithStoreProductCodes(
  storeId: number,
  glopos: GloposWastageReportParseResult,
) {
  const enriched = await enrichGloposWastageRowsWithStoreProductCodes(
    storeId,
    glopos,
  );
  const previewHeaders = [WASTAGE_PRODUCT_CODE_COLUMN, WASTAGE_QTY_COLUMN];
  if (glopos.rows.some((r) => r[WASTAGE_BARCODE_COLUMN])) {
    previewHeaders.splice(1, 0, WASTAGE_BARCODE_COLUMN);
  }

  const fileBarcodeByCode = new Map(
    glopos.rows.map((row) => [
      catalogCodeKey(normalizeProductCode(row[glopos.productCodeColumn] ?? "")),
      row[WASTAGE_BARCODE_COLUMN] ?? "",
    ]),
  );

  const previewRows = enriched.rows.slice(0, 10).map((row) => ({
    [WASTAGE_PRODUCT_CODE_COLUMN]: row[WASTAGE_PRODUCT_CODE_COLUMN] ?? "",
    ...(previewHeaders.includes(WASTAGE_BARCODE_COLUMN)
      ? {
          [WASTAGE_BARCODE_COLUMN]:
            fileBarcodeByCode.get(
              catalogCodeKey(row[WASTAGE_PRODUCT_CODE_COLUMN] ?? ""),
            ) ?? "",
        }
      : {}),
    [WASTAGE_QTY_COLUMN]: row[WASTAGE_QTY_COLUMN] ?? "",
  }));

  return {
    headers: previewHeaders,
    rows: previewRows,
    referenceColumn: WASTAGE_PRODUCT_CODE_COLUMN,
    quantityColumn: WASTAGE_QTY_COLUMN,
    mappingType: "store_product_code" as const,
    wastageDate: glopos.wastageDate ?? undefined,
    duplicateRows: glopos.duplicateRows,
    skippedExcludedReasonRows: glopos.skippedExcludedReasonRows,
    matchedCount: enriched.matchedCount,
    unmatchedCount: enriched.unmatchedCodes.length,
    unmatchedCodes: enriched.unmatchedCodes.slice(0, 15),
  };
}

export async function importWastageQuantityBatch(input: {
  storeId: number;
  wastageDate: string;
  rows: PreparedWastageRow[];
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
    wastageDate: string;
    wastageQty: string;
  }> = [];

  for (const row of input.rows) {
    const storeProductId = storeProductByReference.get(row.reference);
    if (!storeProductId) {
      input.result.unmatchedRows += 1;
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
      wastageDate: input.wastageDate,
      wastageQty: decimalToDb(row.qty),
    });
  }

  if (toUpsert.length) {
    await wastageRepository.upsertBatch(toUpsert);
    input.result.matchedRows += toUpsert.length;
  }
}

/** Import wastage rows already keyed by store product code. */
export async function importWastageRows(input: {
  storeId: number;
  wastageDate: string;
  mappingType?: SalesMappingType;
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
}): Promise<ImportResult> {
  const prepared = prepareWastageImport({
    referenceColumn: input.referenceColumn,
    quantityColumn: input.quantityColumn,
    rows: input.rows,
  });

  await importWastageQuantityBatch({
    storeId: input.storeId,
    wastageDate: input.wastageDate,
    rows: prepared.rows,
    result: prepared.result,
  });

  return prepared.result;
}

export type WastageStoreSummary = {
  wastageDate: string;
  itemCount: number;
  totalWastageQty: string;
  lastUpdated: string;
};

export async function listWastageSummariesForStore(
  storeId: number,
): Promise<WastageStoreSummary[]> {
  const rows = await wastageRepository.listDateSummariesForStore(storeId);
  return rows.map((row) => ({
    wastageDate: row.wastageDate,
    itemCount: row.itemCount,
    totalWastageQty: String(row.totalWastageQty),
    lastUpdated: String(row.lastUpdated),
  }));
}

export async function deleteWastageForStoreDate(
  storeId: number,
  wastageDate: string,
): Promise<void> {
  await wastageRepository.deleteForStoreAndDate(storeId, wastageDate);
}
