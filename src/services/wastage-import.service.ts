import { db } from "@/db";
import type {
  ErpType,
  FilePreview,
  ImportResult,
  ParsedRow,
  SalesMappingType,
} from "@/types";
import {
  productRepository,
  storeRepository,
  storeWastageRepository,
  wastageRepository,
} from "@/repositories";
import { pivotBookStockByReference } from "@/services/book-stock-pivot.service";
import { importStoreQuantityRows } from "@/services/store-quantity-import.service";
import {
  assertStoreFileErpMatch,
  type ParseImportFileInput,
} from "@/services/import-parse.service";
import type { GloposWastageReportParseResult } from "@/parsers/glopos-wastage-report-parser";
import {
  isGloposWastageReport,
  parseGloposWastageReport,
  tryParseGloposWastageReport,
  WASTAGE_BARCODE_COLUMN,
  WASTAGE_PRODUCT_CODE_COLUMN,
  WASTAGE_QTY_COLUMN,
} from "@/parsers/glopos-wastage-report-parser";
import {
  detectWastageColumns,
  parseAllRows,
  parseUploadedFile,
} from "@/parsers/file-parser";
import { normalizeProductCode } from "@/parsers/product-file-parser";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import {
  detectWastageFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { wastageImportSchema } from "@/validators/schemas";

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

/** Inspect a wastage upload for UI column mapping (does not persist). */
export async function parseWastageImportFile(
  input: ParseImportFileInput,
): Promise<WastageParseResult> {
  let gloposWastage = await tryParseGloposWastageReport(
    input.buffer,
    input.fileName,
  );
  if (!gloposWastage && isGloposWastageReport([], input.fileName)) {
    try {
      gloposWastage = await parseGloposWastageReport(
        input.buffer,
        input.fileName,
      );
    } catch (err) {
      throw new Error(
        err instanceof Error ?
          err.message
        : "Failed to parse GloPOS wastage file",
      );
    }
  }

  let preview: WastageParseResult;

  if (gloposWastage) {
    preview = {
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
  } else {
    preview = await parseUploadedFile(input.buffer, input.fileName);
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
  }

  await assertStoreFileErpMatch({
    storeId: input.storeId,
    headers: preview.headers,
    fileName: input.fileName,
    detectFileErpType: detectWastageFileErpType,
  });

  return preview;
}

/** Map GloPOS wastage file codes/barcodes to store catalog item codes before upsert. */
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

  const storeProducts = await productRepository.findStoreProductsByCodes(storeId, fileCodes);
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
    const extra = await productRepository.findStoreProductsByCodes(storeId, shortCodes);
    for (const sp of extra) {
      byCatalogCode.set(catalogCodeKey(sp.storeProductCode), sp);
    }
  }

  const barcodesForLookup = glopos.rows
    .map((row) => formatSpreadsheetBarcode(row[WASTAGE_BARCODE_COLUMN] ?? "").trim())
    .filter(Boolean);
  const barcodeMatches = await productRepository.findStoreProductMatchesForFileBarcodes(
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
    const fileBarcode = formatSpreadsheetBarcode(row[WASTAGE_BARCODE_COLUMN] ?? "").trim();

    let storeProductCode: string | null = null;

    const direct = fileCode ? byCatalogCode.get(catalogCodeKey(fileCode)) : undefined;
    if (direct) {
      storeProductCode = direct.storeProductCode;
    }

    if (!storeProductCode && fileBarcode) {
      const asCode = normalizeProductCode(fileBarcode);
      const fromShortCode = asCode ? byCatalogCode.get(catalogCodeKey(asCode)) : undefined;
      if (fromShortCode) {
        storeProductCode = fromShortCode.storeProductCode;
      }
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
  const enriched = await enrichGloposWastageRowsWithStoreProductCodes(storeId, glopos);
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
    ...(previewHeaders.includes(WASTAGE_BARCODE_COLUMN) ?
      {
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

export async function importWastageRows(input: {
  storeId: number;
  wastageDate: string;
  mappingType: SalesMappingType;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
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

export type WastageStoreSummary = {
  wastageDate: string;
  itemCount: number;
  totalWastageQty: string;
  lastUpdated: string;
};

export async function listWastageSummariesForStore(
  storeId: number,
): Promise<WastageStoreSummary[]> {
  const rows = await storeWastageRepository.listDateSummariesForStore(storeId);
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
  await storeWastageRepository.deleteForStoreAndDate(storeId, wastageDate);
}

/** Resolve + import wastage from an uploaded FormData payload. */
export async function importWastageFromForm(
  formData: FormData,
): Promise<ImportResult & { importId: number }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const meta = wastageImportSchema.safeParse({
    storeId: formData.get("storeId"),
    wastageDate: formData.get("wastageDate"),
    mappingType: formData.get("mappingType") || "store_product_code",
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
    fileName: file.name,
  });
  if (!meta.success) throw new Error(meta.error.message);

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) throw new Error("Store not found");

  const buffer = Buffer.from(await file.arrayBuffer());
  let gloposWastage = await tryParseGloposWastageReport(buffer, file.name);
  if (!gloposWastage && isGloposWastageReport([], file.name)) {
    gloposWastage = await parseGloposWastageReport(buffer, file.name);
  }

  let rows: ParsedRow[];
  let importMeta = { ...meta.data };
  let previewHeaders: string[] = [];
  let skipReferencePivot = false;

  if (gloposWastage) {
    if (!gloposWastage.rows.length) {
      throw new Error("No wastage product rows found in the file.");
    }
    const enriched = await enrichGloposWastageRowsWithStoreProductCodes(
      meta.data.storeId,
      gloposWastage,
    );
    if (!enriched.rows.length) {
      const sample = enriched.unmatchedCodes.slice(0, 5).join(", ");
      throw new Error(
        enriched.unmatchedCodes.length
          ? `No store products matched the file (${enriched.unmatchedCodes.length} unmatched${sample ? `: ${sample}` : ""}). Import the product catalog for this store first, then try again.`
          : "No wastage product rows found in the file.",
      );
    }
    rows = enriched.rows;
    previewHeaders = gloposWastage.headers;
    skipReferencePivot = true;
    importMeta = {
      ...importMeta,
      referenceColumn: gloposWastage.productCodeColumn,
      quantityColumn: gloposWastage.quantityColumn,
      mappingType: "store_product_code",
      wastageDate:
        importMeta.wastageDate ||
        gloposWastage.wastageDate ||
        meta.data.wastageDate,
    };
  } else {
    const all = await parseAllRows(buffer, file.name);
    rows = all.rows;
    previewHeaders = all.headers;
  }

  const storeErpType = resolveStoreErpType(store.erpType);
  const mismatch = validateErpFileMatch(
    detectWastageFileErpType(previewHeaders, file.name),
    storeErpType,
  );
  if (mismatch) throw new Error(mismatch);

  return importWastageRows({
    ...importMeta,
    rows,
    erpType: storeErpType,
    skipReferencePivot,
  });
}
