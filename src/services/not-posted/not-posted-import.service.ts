import type { ImportResult } from "@/types";
import { decimalToDb, toDecimal } from "@/utils/decimal";
import { normalizeProductCode } from "@/parsers/products/product-file-parser";
import {
  parseNotPostedFileBuffer,
  pivotNotPostedRows,
} from "@/parsers/not-posted/not-posted-file-parser";
import {
  BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE,
  BOOK_STOCK_INSERT_BATCH_SIZE,
} from "@/lib/import-config";
import {
  bookStockRepository,
  notPostedDeliveryRepository,
  productRepository,
  storeRepository,
} from "@/repositories";
import {
  catalogCodeKey,
  indexStoreProducts,
  resolveStoreProduct,
  type StoreProductRef,
} from "@/services/book-stock/book-stock-product-lookup";

function chunkArray<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function loadStoreProductMap(storeId: number, codes: string[]) {
  const unique = [...new Set(codes.map((code) => normalizeProductCode(code)).filter(Boolean))];
  const productByCode = new Map<string, StoreProductRef>();

  for (const batch of chunkArray(unique, BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE)) {
    const rows = await productRepository.findStoreProductsByCodes(storeId, batch);
    for (const [key, product] of indexStoreProducts(rows)) {
      productByCode.set(key, product);
    }
  }

  const missing = unique.filter((code) => !resolveStoreProduct(productByCode, code));
  if (missing.length) {
    for (const batch of chunkArray(
      [...new Set(missing.map((code) => catalogCodeKey(code)))],
      BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE,
    )) {
      const loose = await productRepository.findStoreProductsByLowercaseCodes(storeId, batch);
      for (const [key, product] of indexStoreProducts(loose)) {
        productByCode.set(key, product);
      }
    }
  }

  return productByCode;
}

export async function importNotPostedDeliveryFile(input: {
  storeId: number;
  fileName: string;
  buffer: Buffer;
  importedAt?: Date;
}): Promise<ImportResult & { fileName: string; importedAt: string }> {
  const store = await storeRepository.getById(input.storeId);
  if (!store) throw new Error("Store not found");

  const hasBookStock = await bookStockRepository.getLatestImportedAt(input.storeId);
  if (!hasBookStock) {
    throw new Error("Upload book stock first, then add not-posted files for this generate.");
  }

  const parsed = await parseNotPostedFileBuffer(input.buffer, input.fileName);
  const pivoted = pivotNotPostedRows(
    parsed.rows,
    parsed.itemCodeColumn,
    parsed.quantityColumn,
  );

  const result: ImportResult = {
    totalRows: parsed.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: parsed.rows.length - pivoted.length,
    errors: [],
  };

  if (!pivoted.length) {
    throw new Error("No Item Code / Rec Total Unit rows found in this file.");
  }

  const productByCode = await loadStoreProductMap(
    input.storeId,
    pivoted.map((row) => row.itemCode),
  );
  const importedAt = input.importedAt ?? new Date();
  const inserts: Array<{
    storeProductId: number;
    quantity: string;
    fileName: string;
    importedAt: Date;
  }> = [];

  for (const row of pivoted) {
    const product = resolveStoreProduct(productByCode, row.itemCode);
    if (!product) {
      result.unmatchedRows += 1;
      result.errors.push({
        rowNumber: row.rowNumber,
        reference: row.itemCode,
        message: "No matching store product",
      });
      continue;
    }
    inserts.push({
      storeProductId: product.id,
      quantity: decimalToDb(toDecimal(row.quantity)),
      fileName: input.fileName,
      importedAt,
    });
    result.matchedRows += 1;
  }

  for (const batch of chunkArray(inserts, BOOK_STOCK_INSERT_BATCH_SIZE)) {
    await notPostedDeliveryRepository.insertBatch(batch);
  }

  return {
    ...result,
    fileName: input.fileName,
    importedAt: importedAt.toISOString(),
  };
}

export async function importNotPostedDeliveryFiles(input: {
  storeId: number;
  files: Array<{ fileName: string; buffer: Buffer }>;
}) {
  const results: Array<ImportResult & { fileName: string; importedAt: string }> = [];
  const errors: Array<{ fileName: string; error: string }> = [];
  const startedAt = Date.now();

  for (const [index, file] of input.files.entries()) {
    try {
      results.push(
        await importNotPostedDeliveryFile({
          storeId: input.storeId,
          fileName: file.fileName,
          buffer: file.buffer,
          importedAt: new Date(startedAt + index),
        }),
      );
    } catch (error) {
      errors.push({
        fileName: file.fileName,
        error: error instanceof Error ? error.message : "Import failed",
      });
    }
  }

  if (!results.length) {
    throw new Error(
      errors.map((entry) => `${entry.fileName}: ${entry.error}`).join(" ") ||
        "No delivery files were imported.",
    );
  }

  return { results, errors };
}

export async function listNotPostedUploads(storeId: number) {
  return notPostedDeliveryRepository.listUploadsForStore(storeId);
}

export async function deleteNotPostedUpload(storeId: number, importedAt: string) {
  const parsed = new Date(importedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid importedAt timestamp");
  }
  await notPostedDeliveryRepository.deleteForStoreAndImportedAt(storeId, parsed);
}

export async function getNotPostedStoreSummary(storeId: number) {
  return notPostedDeliveryRepository.storeSummary(storeId);
}

export async function clearNotPostedForStore(storeId: number) {
  await notPostedDeliveryRepository.deleteForStore(storeId);
}

export async function clearNotPostedForStores(storeIds: number[]) {
  for (const storeId of [...new Set(storeIds)]) {
    await notPostedDeliveryRepository.deleteForStore(storeId);
  }
}
