import type { FilePreview, ImportResult, ParsedRow } from "@/types";
import { decimalToDb } from "@/utils/decimal";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import {
  productRepository,
  promoSalesRepository,
  storeRepository,
} from "@/repositories";
import {
  assertStoreFileErpMatch,
  type ParseImportFileInput,
} from "@/services/import-parse.service";
import {
  preparePromoImport,
  PROMO_ITEM_CODE_COLUMN,
  remapPromoBarcodeRowsToStoreProductCodes,
  type PreparedPromoRow,
} from "@/services/promo-import-prepare";
import {
  tryParseMspPromotionItemDetailReport,
  type MspPromotionItemDetailParseResult,
} from "@/parsers/msp-promotion-item-detail-parser";
import { detectPromoColumns, parseUploadedFile } from "@/parsers/file-parser";
import {
  detectPromoFileErpType,
  resolveStoreErpType,
} from "@/utils/erp-file-validation";

export { preparePromoImport, PROMO_ITEM_CODE_COLUMN };
export type { PreparedPromoRow };

export type PromoParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  promoDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedCodes?: string[];
};

export async function buildMspPromoPreviewWithStoreProductCodes(
  storeId: number,
  parsed: MspPromotionItemDetailParseResult,
) {
  const fileBarcodes = parsed.rows.map((row) =>
    formatSpreadsheetBarcode(row[parsed.barcodeColumn] ?? "").trim(),
  );
  const matches =
    await productRepository.findStoreProductMatchesForFileBarcodes(
      storeId,
      fileBarcodes,
    );
  const remapped = remapPromoBarcodeRowsToStoreProductCodes({
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
    const code = row[PROMO_ITEM_CODE_COLUMN] ?? "";
    const match = [...byFileBarcode.values()].find(
      (m) => m.storeProductCode === code,
    );
    return {
      [PROMO_ITEM_CODE_COLUMN]: code,
      [parsed.barcodeColumn]: match?.fileBarcode ?? "",
      [parsed.quantityColumn]: row[parsed.quantityColumn] ?? "",
    };
  });

  return {
    headers: [
      PROMO_ITEM_CODE_COLUMN,
      parsed.barcodeColumn,
      parsed.quantityColumn,
    ],
    rows: previewRows,
    referenceColumn: PROMO_ITEM_CODE_COLUMN,
    quantityColumn: parsed.quantityColumn,
    mappingType: "barcode" as const,
    promoDate: parsed.promoDate ?? undefined,
    duplicateRows: parsed.duplicateRows,
    matchedCount: remapped.matchedCount,
    unmatchedCount: unmatchedBarcodes.length,
    unmatchedCodes: unmatchedBarcodes.slice(0, 15),
  };
}

export async function parsePromoImportFile(
  input: ParseImportFileInput,
): Promise<PromoParseResult> {
  const mspPromo = await tryParseMspPromotionItemDetailReport(
    input.buffer,
    input.fileName,
  );

  if (mspPromo) {
    let preview: PromoParseResult = {
      headers: mspPromo.headers,
      rows: mspPromo.rows.slice(0, 10),
      referenceColumn: mspPromo.barcodeColumn,
      quantityColumn: mspPromo.quantityColumn,
      promoDate: mspPromo.promoDate ?? undefined,
      duplicateRows: mspPromo.duplicateRows,
      mappingType: "barcode",
    };
    if (input.storeId) {
      const enriched = await buildMspPromoPreviewWithStoreProductCodes(
        input.storeId,
        mspPromo,
      );
      preview = { ...enriched, rows: enriched.rows.slice(0, 10) };
    }
    await assertStoreFileErpMatch({
      storeId: input.storeId,
      headers: ["Barcode", "Promo Qty"],
      fileName: input.fileName,
      detectFileErpType: detectPromoFileErpType,
    });
    return preview;
  }

  let preview: PromoParseResult = await parseUploadedFile(
    input.buffer,
    input.fileName,
  );
  if (input.storeId) {
    const store = await storeRepository.getById(input.storeId);
    if (store) {
      const detected = detectPromoColumns(
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
    detectFileErpType: detectPromoFileErpType,
  });

  return preview;
}

export async function importPromoQuantityBatch(input: {
  storeId: number;
  promoDate: string;
  rows: PreparedPromoRow[];
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
    promoDate: string;
    promoQty: string;
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
      promoDate: input.promoDate,
      promoQty: decimalToDb(row.qty),
    });
  }

  if (toUpsert.length) {
    await promoSalesRepository.upsertBatch(toUpsert);
    input.result.matchedRows += toUpsert.length;
  }
}

/** Import promo rows already keyed by store product code. */
export async function importPromoRows(input: {
  storeId: number;
  promoDate: string;
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
}): Promise<ImportResult> {
  const prepared = preparePromoImport({
    referenceColumn: input.referenceColumn,
    quantityColumn: input.quantityColumn,
    rows: input.rows,
  });

  await importPromoQuantityBatch({
    storeId: input.storeId,
    promoDate: input.promoDate,
    rows: prepared.rows,
    result: prepared.result,
  });

  return prepared.result;
}

export type PromoStoreSummary = {
  promoDate: string;
  itemCount: number;
  totalPromoQty: string;
  lastUpdated: string;
};

export async function listPromoSummariesForStore(
  storeId: number,
): Promise<PromoStoreSummary[]> {
  const rows = await promoSalesRepository.listDateSummariesForStore(storeId);
  return rows.map((row) => ({
    promoDate: row.promoDate,
    itemCount: row.itemCount,
    totalPromoQty: String(row.totalPromoQty),
    lastUpdated: String(row.lastUpdated),
  }));
}

export async function deletePromoForStoreDate(
  storeId: number,
  promoDate: string,
): Promise<void> {
  await promoSalesRepository.deleteForStoreAndDate(storeId, promoDate);
}
