import type { ErpType, ImportResult, ParsedRow } from "@/types";
import {
  dedupeProductRows,
  normalizeProductCode,
} from "@/parsers/product-file-parser";
import { productRepository, storeRepository } from "@/repositories/postgres";

const BATCH_SIZE = 2000;
const UPDATE_BATCH_SIZE = 200;

type NormalizedImportRow = {
  rowNumber: number;
  productCode: string;
  name: string;
  department: string;
  barcode?: string;
};

export type { NormalizedImportRow };

export const IMPORT_JOB_BATCH_SIZE = 2000;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function prepareProductImportJob(input: {
  storeId: number;
  codeColumn: string;
  nameColumn: string;
  departmentColumn?: string;
  barcodeColumn?: string;
  shareAcrossMspStores?: boolean;
  rows: ParsedRow[];
}): Promise<{
  normalizedRows: NormalizedImportRow[];
  result: ImportResult;
  shareAcrossMspStores: boolean;
}> {
  const store = await storeRepository.getById(input.storeId);
  if (!store) throw new Error("Store not found");

  const erpType: ErpType = store.erpType === "glopos" ? "glopos" : "msp";
  const shareAcrossMspStores =
    erpType === "msp" && (input.shareAcrossMspStores ?? false);
  const { rows, duplicateRows: fileDuplicates } = dedupeProductRows(
    input.rows,
    input.codeColumn,
    input.barcodeColumn,
  );

  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: fileDuplicates,
    errors: [],
  };

  const normalizedRows = normalizeImportRows(input, rows, result);
  return { normalizedRows, result, shareAcrossMspStores };
}

export async function importNormalizedRowsBatch(input: {
  storeId: number;
  shareAcrossMspStores: boolean;
  rows: NormalizedImportRow[];
  result: ImportResult;
}) {
  if (!input.rows.length) return;

  if (input.shareAcrossMspStores) {
    await importMspSharedProductsBulk({
      storeId: input.storeId,
      rows: input.rows,
      result: input.result,
    });
  } else {
    await importPerStoreProductsBulk({
      storeId: input.storeId,
      rows: input.rows,
      result: input.result,
    });
  }
}

function normalizeImportRows(
  input: {
    codeColumn: string;
    nameColumn: string;
    departmentColumn?: string;
    barcodeColumn?: string;
  },
  rows: ParsedRow[],
  result: ImportResult,
): NormalizedImportRow[] {
  const normalizedRows: NormalizedImportRow[] = [];

  for (const row of rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const productCode = normalizeProductCode(row[input.codeColumn] ?? "");
    const name = row[input.nameColumn]?.trim() ?? "";
    const department = input.departmentColumn
      ? row[input.departmentColumn]?.trim() || "General"
      : "General";
    const barcode = input.barcodeColumn
      ? String(row[input.barcodeColumn] ?? "").trim()
      : "";

    if (!productCode || !name) {
      result.invalidRows += 1;
      if (result.errors.length < 25) {
        result.errors.push({
          rowNumber,
          reference: productCode || null,
          message: "Missing product code or name",
        });
      }
      continue;
    }

    normalizedRows.push({
      rowNumber,
      productCode,
      name,
      department,
      barcode: barcode || undefined,
    });
  }

  return normalizedRows;
}

export async function importProductRows(input: {
  storeId: number;
  codeColumn: string;
  nameColumn: string;
  departmentColumn?: string;
  barcodeColumn?: string;
  shareAcrossMspStores?: boolean;
  rows: ParsedRow[];
}): Promise<ImportResult> {
  const { normalizedRows, result, shareAcrossMspStores } =
    await prepareProductImportJob(input);

  await importNormalizedRowsBatch({
    storeId: input.storeId,
    shareAcrossMspStores,
    rows: normalizedRows,
    result,
  });

  return result;
}

async function importPerStoreProductsBulk(input: {
  storeId: number;
  rows: NormalizedImportRow[];
  result: ImportResult;
}) {
  const existingRows = await productRepository.listStoreProductsForStore(input.storeId);
  const existingByCode = new Map(
    existingRows.map((row) => [row.storeProduct.storeProductCode, row]),
  );

  const toCreate: NormalizedImportRow[] = [];
  const toUpdate: Array<{ productId: number; name: string; department: string }> =
    [];

  for (const row of input.rows) {
    const existing = existingByCode.get(row.productCode);
    if (existing) {
      toUpdate.push({
        productId: existing.product.id,
        name: row.name,
        department: row.department,
      });
      input.result.duplicateRows = (input.result.duplicateRows ?? 0) + 1;
    } else {
      toCreate.push(row);
    }
  }

  for (const batch of chunk(toUpdate, UPDATE_BATCH_SIZE)) {
    await Promise.all(
      batch.map((row) =>
        productRepository.updateProduct(row.productId, {
          name: row.name,
          department: row.department,
        }),
      ),
    );
  }

  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    const createdProducts = await productRepository.createProductsBatch(
      batch.map((row) => ({
        name: row.name,
        department: row.department,
        isActive: true,
      })),
    );

    await productRepository.upsertStoreProductsBatch(
      createdProducts.map((product, index) => ({
        storeId: input.storeId,
        productId: product.id,
        storeProductCode: batch[index]!.productCode,
        isActive: true,
      })),
    );

    const barcodeRows = [];
    for (let index = 0; index < batch.length; index += 1) {
      const barcode = batch[index]?.barcode;
      const productId = createdProducts[index]?.id;
      if (!barcode || !productId) continue;
      barcodeRows.push({ productId, barcode });
    }

    if (barcodeRows.length) {
      await productRepository.insertBarcodesBatch(barcodeRows);
    }

    input.result.matchedRows += batch.length;
  }
}

async function importMspSharedProductsBulk(input: {
  storeId: number;
  rows: NormalizedImportRow[];
  result: ImportResult;
}) {
  const existingRows = await productRepository.listStoreProductsForStore(input.storeId);
  const existingByCode = new Map(
    existingRows.map((row) => [row.storeProduct.storeProductCode, row]),
  );

  const missingCodes = [
    ...new Set(
      input.rows
        .filter((row) => !existingByCode.has(row.productCode))
        .map((row) => row.productCode),
    ),
  ];
  const sharedRows = await productRepository.listMspStoreProductsByCodes(missingCodes);
  const sharedByCode = new Map(
    sharedRows.map((row) => [row.storeProduct.storeProductCode, row]),
  );

  const toCreate: NormalizedImportRow[] = [];
  const toUpdate: Array<{ productId: number; name: string; department: string }> =
    [];
  const toLink: Array<{
    productId: number;
    productCode: string;
    name: string;
    department: string;
    barcode?: string;
  }> = [];

  for (const row of input.rows) {
    const existing = existingByCode.get(row.productCode);
    if (existing) {
      toUpdate.push({
        productId: existing.product.id,
        name: row.name,
        department: row.department,
      });
      input.result.duplicateRows = (input.result.duplicateRows ?? 0) + 1;
      continue;
    }

    const shared = sharedByCode.get(row.productCode);
    if (shared) {
      toLink.push({
        productId: shared.product.id,
        productCode: row.productCode,
        name: row.name,
        department: row.department,
        barcode: row.barcode,
      });
      continue;
    }

    toCreate.push(row);
  }

  for (const batch of chunk(toUpdate, UPDATE_BATCH_SIZE)) {
    await Promise.all(
      batch.map((row) =>
        productRepository.updateProduct(row.productId, {
          name: row.name,
          department: row.department,
        }),
      ),
    );
  }

  for (const batch of chunk(toLink, BATCH_SIZE)) {
    await Promise.all(
      batch.map((row) =>
        productRepository.updateProduct(row.productId, {
          name: row.name,
          department: row.department,
        }),
      ),
    );
    await productRepository.upsertStoreProductsBatch(
      batch.map((row) => ({
        storeId: input.storeId,
        productId: row.productId,
        storeProductCode: row.productCode,
        isActive: true,
      })),
    );
    input.result.matchedRows += batch.length;
  }

  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    const createdProducts = await productRepository.createProductsBatch(
      batch.map((row) => ({
        name: row.name,
        department: row.department,
        isActive: true,
      })),
    );

    await productRepository.upsertStoreProductsBatch(
      createdProducts.map((product, index) => ({
        storeId: input.storeId,
        productId: product.id,
        storeProductCode: batch[index]!.productCode,
        isActive: true,
      })),
    );

    const barcodeRows = [];
    for (let index = 0; index < batch.length; index += 1) {
      const barcode = batch[index]?.barcode;
      const productId = createdProducts[index]?.id;
      if (!barcode || !productId) continue;
      barcodeRows.push({ productId, barcode });
    }

    if (barcodeRows.length) {
      await productRepository.insertBarcodesBatch(barcodeRows);
    }

    input.result.matchedRows += batch.length;
  }

  for (const batch of chunk(toLink, BATCH_SIZE)) {
    const barcodeRows = [];
    for (const row of batch) {
      if (!row.barcode) continue;
      barcodeRows.push({ productId: row.productId, barcode: row.barcode });
    }
    if (barcodeRows.length) {
      await productRepository.insertBarcodesBatch(barcodeRows);
    }
  }
}
