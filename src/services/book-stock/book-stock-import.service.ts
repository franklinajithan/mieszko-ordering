import {recordUnmatchedIdentifiers} from '@/services/operations/import-observations.service';
import { InputError } from "@/utils/input-error";
import { db } from "@/db";
import { bookStock, notPostedDeliveries, storeProducts } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ErpType, ImportResult, ParsedRow } from "@/types";
import { toDecimal, decimalToDb } from "@/utils/decimal";
import {
  bookStockRepository,
  productRepository,
  storeRepository,
} from "@/repositories";
import { parseBookStockFileBuffer } from "@/parsers/book-stock/book-stock-file-parser";
import { normalizeProductCode } from "@/parsers/products/product-file-parser";
import { pivotBookStockByReference } from "@/services/book-stock/book-stock-pivot.service";
import {
  detectBookStockFileErpType,
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";
import { assertStoreFileErpMatch } from "@/services/import-parse.service";
import { bookStockImportSchema } from "@/validators/schemas";
import {
  BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE,
  BOOK_STOCK_INSERT_BATCH_SIZE,
} from "@/lib/import-config";
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
  const unique = [...new Set(codes.map((c) => normalizeProductCode(c)).filter(Boolean))];
  const productByCode = new Map<string, StoreProductRef>();

  for (const codeBatch of chunkArray(unique, BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE)) {
    const storeProducts = await productRepository.findStoreProductsByCodes(
      storeId,
      codeBatch,
    );
    for (const [key, product] of indexStoreProducts(storeProducts)) {
      productByCode.set(key, product);
    }
  }

  const missing = unique.filter((code) => !resolveStoreProduct(productByCode, code));
  if (missing.length) {
    const lowerBatch = [...new Set(missing.map((c) => catalogCodeKey(c)))];
    for (const batch of chunkArray(lowerBatch, BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE)) {
      const loose = await productRepository.findStoreProductsByLowercaseCodes(
        storeId,
        batch,
      );
      for (const [key, product] of indexStoreProducts(loose)) {
        productByCode.set(key, product);
      }
    }
  }

  return productByCode;
}

async function processBookStockRowBatch(input: {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  rows: ParsedRow[];
  productByCode?: Map<string, StoreProductRef>;
}): Promise<{
  result: ImportResult;
  validRows: Array<{
    storeProductId: number;
    bookStockDate: string;
    bookStockQty: string;
  }>;
}> {
  const result: ImportResult = {
    totalRows: input.rows.length,
    matchedRows: 0,
    unmatchedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  };

  type ParsedEntry = {
    rowNumber: number;
    reference: string;
    quantity: ReturnType<typeof toDecimal>;
  };
  const parsed: ParsedEntry[] = [];

  for (const row of input.rows) {
    const rowNumber = Number(row.__rowNumber ?? 0);
    const reference = normalizeProductCode(
      row[input.referenceColumn]?.trim() ?? "",
    );
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

    let quantity;
    try {
      if (!qtyRaw) throw new InputError("Missing quantity");
      quantity = toDecimal(qtyRaw);
      if (!quantity.isFinite()) throw new InputError("invalid");
    } catch {
      result.invalidRows += 1;
      result.errors.push({
        rowNumber,
        reference,
        message: "Invalid quantity",
      });
      continue;
    }

    parsed.push({ rowNumber, reference, quantity });
  }

  const productByCode =
    input.productByCode ??
    (await loadStoreProductMap(
      input.storeId,
      [...new Set(parsed.map((entry) => entry.reference))],
    ));

  const validRows: Array<{
    storeProductId: number;
    bookStockDate: string;
    bookStockQty: string;
  }> = [];

  const unmatchedIdentifiers:string[]=[];
  for (const entry of parsed) {
    const storeProduct = resolveStoreProduct(productByCode, entry.reference);
    if (!storeProduct) {
      result.unmatchedRows += 1;
      unmatchedIdentifiers.push(entry.reference);
      result.errors.push({
        rowNumber: entry.rowNumber,
        reference: entry.reference,
        message: "No matching store product",
      });
      continue;
    }

    validRows.push({
      storeProductId: storeProduct.id,
      bookStockDate: input.bookStockDate,
      bookStockQty: decimalToDb(entry.quantity),
    });
    result.matchedRows += 1;
  }

  await recordUnmatchedIdentifiers(input.storeId,'book_stock','unknown_product_code',unmatchedIdentifiers);
  return { result, validRows };
}

/** Save an entire prepared book-stock upload (used by FormData / whole-file import). */
export async function importBookStockBulk(input: {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  rows: ParsedRow[];
  duplicateRows?: number;
  importedAt?: string;
}): Promise<ImportResult & { importedAt: string }> {
  if (!input.rows.length) {
    throw new InputError("No rows to import");
  }

  const importedAt = input.importedAt
    ? new Date(input.importedAt)
    : new Date();
  if (Number.isNaN(importedAt.getTime())) {
    throw new InputError("Invalid importedAt timestamp");
  }

  const uniqueCodes = [
    ...new Set(
      input.rows
        .map((row) =>
          normalizeProductCode(row[input.referenceColumn]?.trim() ?? ""),
        )
        .filter(Boolean),
    ),
  ];
  const productByCode = await loadStoreProductMap(input.storeId, uniqueCodes);

  const { result, validRows } = await processBookStockRowBatch({
    storeId: input.storeId,
    bookStockDate: input.bookStockDate,
    referenceColumn: input.referenceColumn,
    quantityColumn: input.quantityColumn,
    rows: input.rows,
    productByCode,
  });

  if (!validRows.length || result.invalidRows || result.unmatchedRows) {
    throw new InputError(`Stock snapshot rejected: ${result.invalidRows} invalid and ${result.unmatchedRows} unmatched rows. Previous snapshot retained.`);
  }
  await db.transaction(async (tx) => {
    for (const batch of chunkArray(validRows, BOOK_STOCK_INSERT_BATCH_SIZE)) {
      await tx.insert(bookStock).values(batch.map(row => ({ ...row, importedAt, updatedAt: importedAt, createdAt: importedAt })));
    }
    await tx.delete(notPostedDeliveries).where(inArray(notPostedDeliveries.storeProductId,
      tx.select({ id: storeProducts.id }).from(storeProducts).where(eq(storeProducts.storeId, input.storeId))));
  });

  return {
    ...result,
    duplicateRows: input.duplicateRows ?? result.duplicateRows,
    importedAt: importedAt.toISOString(),
  };
}

/**
 * Import one chunk of book-stock rows.
 * Pass the same `importedAt` across chunks so they share one upload timestamp.
 * First chunk may omit it; the returned `importedAt` must be reused.
 */
export async function importBookStockChunk(input: {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  rows: ParsedRow[];
  importedAt?: string;
  totalRows: number;
}): Promise<ImportResult & { importedAt: string }> {
  if (!input.rows.length) {
    throw new InputError("No rows to import");
  }

  const importedAt = input.importedAt
    ? new Date(input.importedAt)
    : new Date();
  if (Number.isNaN(importedAt.getTime())) {
    throw new InputError("Invalid importedAt timestamp");
  }

  const chunkCodes = [
    ...new Set(
      input.rows
        .map((row) =>
          normalizeProductCode(row[input.referenceColumn]?.trim() ?? ""),
        )
        .filter(Boolean),
    ),
  ];
  const productByCode = await loadStoreProductMap(input.storeId, chunkCodes);

  const { result: chunkResult, validRows } = await processBookStockRowBatch({
    storeId: input.storeId,
    bookStockDate: input.bookStockDate,
    referenceColumn: input.referenceColumn,
    quantityColumn: input.quantityColumn,
    rows: input.rows,
    productByCode,
  });

  if (chunkResult.invalidRows || chunkResult.unmatchedRows || !validRows.length) {
    throw new InputError("Stock chunk rejected: invalid or unmatched products. Previous snapshot retained.");
  }
  if (!Number.isSafeInteger(input.totalRows) || input.totalRows < validRows.length) throw new InputError("Invalid upload row count");
  if (new Set(validRows.map(row => row.storeProductId)).size !== validRows.length) throw new InputError("Duplicate products in stock chunk");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73501, ${input.storeId})`);
    const existing = await tx.select({ id: bookStock.id }).from(bookStock).where(and(
      eq(bookStock.importedAt, importedAt),
      inArray(bookStock.storeProductId, tx.select({ id: storeProducts.id }).from(storeProducts).where(eq(storeProducts.storeId, input.storeId))),
    )).limit(1);
    if (existing.length) throw new InputError("This snapshot timestamp is already imported; choose a new timestamp");
    for (const row of validRows) {
      await tx.execute(sql`INSERT INTO book_stock_import_stage
        (store_id, imported_at, store_product_id, book_stock_date, quantity, expected_rows)
        VALUES (${input.storeId}, ${importedAt.toISOString()}, ${row.storeProductId}, ${input.bookStockDate}, ${row.bookStockQty}, ${input.totalRows})
        ON CONFLICT (store_id, imported_at, store_product_id) DO UPDATE SET quantity=EXCLUDED.quantity`);
    }
    const staged = await tx.execute(sql`SELECT count(*)::int AS count,
      min(expected_rows)::int AS minimum, max(expected_rows)::int AS maximum,
      min(book_stock_date)::text AS first_date, max(book_stock_date)::text AS last_date
      FROM book_stock_import_stage WHERE store_id=${input.storeId} AND imported_at=${importedAt.toISOString()}`);
    const count = Number(staged[0].count);
    if (Number(staged[0].minimum) !== input.totalRows || Number(staged[0].maximum) !== input.totalRows || staged[0].first_date !== input.bookStockDate || staged[0].last_date !== input.bookStockDate || count > input.totalRows) {
      throw new InputError("Inconsistent stock upload metadata");
    }
    if (count === input.totalRows) {
      await tx.execute(sql`INSERT INTO book_stock (store_product_id, book_stock_date, book_stock_qty, imported_at)
        SELECT store_product_id, book_stock_date, quantity, imported_at FROM book_stock_import_stage
        WHERE store_id=${input.storeId} AND imported_at=${importedAt.toISOString()}`);
      await tx.delete(notPostedDeliveries).where(inArray(notPostedDeliveries.storeProductId,
        tx.select({ id: storeProducts.id }).from(storeProducts).where(eq(storeProducts.storeId, input.storeId))));
      await tx.execute(sql`DELETE FROM book_stock_import_stage WHERE store_id=${input.storeId} AND imported_at=${importedAt.toISOString()}`);
    }
  });

  return {
    ...chunkResult,
    importedAt: importedAt.toISOString(),
  };
}

export async function importBookStockRows(input: {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  rows: ParsedRow[];
  erpType?: ErpType;
}): Promise<ImportResult & { importedAt: string }> {
  // Always sum qty by product code before saving (Stock Valuation Detail duplicates).
  const pivoted = pivotBookStockByReference(
    input.rows,
    input.referenceColumn,
    input.quantityColumn,
  );

  return importBookStockBulk({
    storeId: input.storeId,
    bookStockDate: input.bookStockDate,
    referenceColumn: input.referenceColumn,
    quantityColumn: input.quantityColumn,
    fileName: input.fileName,
    rows: pivoted.rows,
    duplicateRows: pivoted.duplicateRows,
  });
}

export async function importBookStockFromForm(
  formData: FormData,
): Promise<ImportResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new InputError("No file uploaded");

  const meta = bookStockImportSchema.safeParse({
    storeId: formData.get("storeId"),
    bookStockDate: formData.get("bookStockDate"),
    referenceColumn: formData.get("referenceColumn"),
    quantityColumn: formData.get("quantityColumn"),
    fileName: file.name,
  });
  if (!meta.success) throw new InputError(meta.error.message);

  const store = await storeRepository.getById(meta.data.storeId);
  if (!store) throw new InputError("Store not found");

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseBookStockFileBuffer(buffer, file.name);
  const storeErpType = resolveStoreErpType(store.erpType);
  const mismatch = validateErpFileMatch(
    detectBookStockFileErpType(parsed.headers, file.name),
    storeErpType,
  );
  if (mismatch) throw new InputError(mismatch);

  const referenceColumn =
    parsed.referenceColumn ?? meta.data.referenceColumn;
  const quantityColumn = parsed.quantityColumn ?? meta.data.quantityColumn;
  const bookStockDate =
    parsed.bookStockDate ?? meta.data.bookStockDate;
  const importErpType =
    parsed.gloposStockValuation || storeErpType === "glopos"
      ? "glopos"
      : storeErpType;

  return importBookStockRows({
    storeId: meta.data.storeId,
    bookStockDate,
    referenceColumn,
    quantityColumn,
    fileName: meta.data.fileName,
    rows: parsed.rows,
    erpType: importErpType,
  }).then((result) =>
    parsed.duplicateRows && result.duplicateRows === 0
      ? { ...result, duplicateRows: parsed.duplicateRows }
      : result,
  );
}

export async function listBookStockSummariesForStore(storeId: number) {
  return bookStockRepository.listUploadSummariesForStore(storeId);
}

export async function deleteBookStockForStoreUpload(
  storeId: number,
  importedAtIso: string,
) {
  const importedAt = new Date(importedAtIso);
  if (Number.isNaN(importedAt.getTime())) {
    throw new InputError("Invalid importedAt timestamp");
  }
  await bookStockRepository.deleteForStoreAndImportedAt(storeId, importedAtIso);
}

export type BookStockParseResult = {
  headers: string[];
  rows: import("@/types").ParsedRow[];
  referenceColumn?: string;
  quantityColumn?: string;
  bookStockDate?: string;
  duplicateRows?: number;
  totalProducts?: number;
};

/** Inspect a book-stock upload for UI preview (does not persist). */
export async function parseBookStockImportFile(input: {
  buffer: Buffer;
  fileName: string;
  storeId?: number;
}): Promise<BookStockParseResult> {
  const parsed = await parseBookStockFileBuffer(input.buffer, input.fileName);

  await assertStoreFileErpMatch({
    storeId: input.storeId,
    headers: parsed.headers,
    fileName: input.fileName,
    detectFileErpType: detectBookStockFileErpType,
  });

  return {
    headers: parsed.headers,
    rows: parsed.rows.slice(0, 10),
    referenceColumn: parsed.referenceColumn,
    quantityColumn: parsed.quantityColumn,
    bookStockDate: parsed.bookStockDate,
    duplicateRows: parsed.duplicateRows,
    totalProducts: parsed.rows.length,
  };
}
