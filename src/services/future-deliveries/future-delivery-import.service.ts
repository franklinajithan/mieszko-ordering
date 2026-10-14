import type { ImportResult } from "@/types";
import { decimalToDb, toDecimal } from "@/utils/decimal";
import { normalizeProductCode } from "@/parsers/products/product-file-parser";
import {
  parseFutureOcsFileBuffer,
  pivotFutureOcsRows,
} from "@/parsers/future-deliveries/future-delivery-file-parser";
import {
  BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE,
  BOOK_STOCK_INSERT_BATCH_SIZE,
} from "@/lib/import-config";
import {
  parseFutureInvoiceFileBuffer,
  parseFutureOrderFileBuffer,
} from "@/parsers/future-deliveries/future-order-file-parser";
import { supplierCodeCompareKey } from "@/parsers/supplier-codes/supplier-code-file-parser";
import {
  futureDeliveryRepository,
  productRepository,
  storeRepository,
  supplierRepository,
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

export async function importFutureOcsFile(input: {
  expectedDeliveryDate?: string;
  storeId: number;
  fileName: string;
  buffer: Buffer;
  importedAt?: Date;
}): Promise<ImportResult & { fileName: string; importedAt: string }> {
  const store = await storeRepository.getById(input.storeId);
  if (!store) throw new Error("Store not found");

  const parsed = await parseFutureOcsFileBuffer(input.buffer, input.fileName);
  const pivoted = pivotFutureOcsRows(
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
    throw new Error("No Item Code / Del Total Unit rows found in this file.");
  }

  const productByCode = await loadStoreProductMap(
    input.storeId,
    pivoted.map((row) => row.itemCode),
  );
  const importedAt = input.importedAt ?? new Date();
  const inserts: Array<{
    storeProductId: number;
    quantity: string;
    source: string;
    fileName: string;
    importedAt: Date;
    expectedDeliveryDate?: string;
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
      source: "ocs",
      fileName: input.fileName,
      importedAt,
      expectedDeliveryDate: input.expectedDeliveryDate,
    });
    result.matchedRows += 1;
  }

  for (const batch of chunkArray(inserts, BOOK_STOCK_INSERT_BATCH_SIZE)) {
    await futureDeliveryRepository.insertBatch(batch);
  }

  return {
    ...result,
    fileName: input.fileName,
    importedAt: importedAt.toISOString(),
  };
}

export async function importFutureOrderFile(input: {
  expectedDeliveryDate?: string;
  storeId: number;
  supplierId: number;
  fileName: string;
  buffer: Buffer;
  importedAt?: Date;
  source?: "order" | "invoice";
}): Promise<ImportResult & { fileName: string; importedAt: string }> {
  const source = input.source ?? "order";
  const [store, supplier] = await Promise.all([
    storeRepository.getById(input.storeId),
    supplierRepository.getById(input.supplierId),
  ]);
  if (!store) throw new Error("Store not found");
  if (!supplier) throw new Error("Supplier not found");

  const parsed =
    source === "invoice"
      ? parseFutureInvoiceFileBuffer(input.buffer, input.fileName)
      : parseFutureOrderFileBuffer(input.buffer, input.fileName);
  const result: ImportResult = {
    totalRows: parsed.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    errors: [],
  };

  const productByCode = new Map<string, { id: number }>();
  const codes = [...new Set(parsed.rows.map((row) => row.supplierCode))];
  for (const batch of chunkArray(codes, BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE)) {
    const rows = await productRepository.findStoreProductsBySupplierCodes(
      input.storeId,
      input.supplierId,
      batch,
    );
    for (const row of rows) {
      productByCode.set(row.supplierCode, { id: row.storeProductId });
      productByCode.set(supplierCodeCompareKey(row.supplierCode), {
        id: row.storeProductId,
      });
    }
  }

  const importedAt = input.importedAt ?? new Date();
  const inserts: Array<{
    storeProductId: number;
    quantity: string;
    source: string;
    supplierId: number;
    fileName: string;
    importedAt: Date;
    expectedDeliveryDate?: string;
  }> = [];

  for (const row of parsed.rows) {
    const product =
      productByCode.get(row.supplierCode) ??
      productByCode.get(supplierCodeCompareKey(row.supplierCode));
    if (!product) {
      result.unmatchedRows += 1;
      result.errors.push({
        rowNumber: row.rowNumber,
        reference: row.supplierCode,
        message: `No store product for ${supplier.code} supplier code`,
      });
      continue;
    }
    inserts.push({
      storeProductId: product.id,
      quantity: decimalToDb(toDecimal(row.quantity)),
      source,
      supplierId: input.supplierId,
      fileName: input.fileName,
      importedAt,
      expectedDeliveryDate: input.expectedDeliveryDate,
    });
    result.matchedRows += 1;
  }

  for (const batch of chunkArray(inserts, BOOK_STOCK_INSERT_BATCH_SIZE)) {
    await futureDeliveryRepository.insertBatch(batch);
  }

  return {
    ...result,
    fileName: input.fileName,
    importedAt: importedAt.toISOString(),
  };
}

export async function importFutureOrderFiles(input: {
  expectedDeliveryDate?: string;
  storeId: number;
  supplierId: number;
  files: Array<{ fileName: string; buffer: Buffer }>;
  source?: "order" | "invoice";
}) {
  const results: Array<ImportResult & { fileName: string; importedAt: string }> = [];
  const errors: Array<{ fileName: string; error: string }> = [];
  const startedAt = Date.now();

  for (const [index, file] of input.files.entries()) {
    try {
      results.push(
        await importFutureOrderFile({
          storeId: input.storeId,
          supplierId: input.supplierId,
          fileName: file.fileName,
          buffer: file.buffer,
          importedAt: new Date(startedAt + index),
          expectedDeliveryDate: input.expectedDeliveryDate,
          source: input.source ?? "order",
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
        "No future order files were imported.",
    );
  }

  return { results, errors };
}

export async function importFutureOcsFiles(input: {
  expectedDeliveryDate?: string;
  storeId: number;
  files: Array<{ fileName: string; buffer: Buffer }>;
}) {
  const results: Array<ImportResult & { fileName: string; importedAt: string }> = [];
  const errors: Array<{ fileName: string; error: string }> = [];
  const startedAt = Date.now();

  for (const [index, file] of input.files.entries()) {
    try {
      results.push(
        await importFutureOcsFile({
          storeId: input.storeId,
          fileName: file.fileName,
          buffer: file.buffer,
          importedAt: new Date(startedAt + index),
          expectedDeliveryDate: input.expectedDeliveryDate,
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
        "No future delivery files were imported.",
    );
  }

  return { results, errors };
}

export async function listFutureUploads(storeId: number) {
  return futureDeliveryRepository.listUploadsForStore(storeId);
}

export async function deleteFutureUpload(storeId: number, importedAt: string) {
  const parsed = new Date(importedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid importedAt timestamp");
  }
  await futureDeliveryRepository.deleteForStoreAndImportedAt(storeId, parsed);
}

export async function getFutureStoreSummary(storeId: number) {
  return futureDeliveryRepository.storeSummary(storeId);
}
