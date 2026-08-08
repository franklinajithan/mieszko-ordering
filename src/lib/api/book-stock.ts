import type { ActionResult, FilePreview, ImportResult } from "@/types";
import type {
  BookStockImportSummary,
  LatestBookStockSummary,
} from "@/services/apply-book-stock-to-order.service";
import {
  BOOK_STOCK_BULK_MAX_ROWS,
  BOOK_STOCK_IMPORT_CHUNK_SIZE,
} from "@/lib/book-stock-import-constants";
import { apiFormRequest, apiRequest } from "./client";

export { BOOK_STOCK_IMPORT_CHUNK_SIZE, BOOK_STOCK_BULK_MAX_ROWS };

export type BookStockParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  bookStockDate?: string;
  duplicateRows?: number;
};

export async function parseBookStockFile(
  formData: FormData,
): Promise<BookStockParseResult> {
  const result = await apiFormRequest<BookStockParseResult>(
    "/imports/book-stock/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export function importBookStock(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiFormRequest("/imports/book-stock", formData);
}

export type BookStockImportChunkInput = {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  importId?: number;
  rows: Array<Record<string, string>>;
};

export function importBookStockChunk(
  input: BookStockImportChunkInput,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiRequest("/imports/book-stock", { method: "POST", body: input });
}

export type BookStockBulkImportInput = {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  duplicateRows?: number;
  rows: Array<Record<string, string>>;
};

export function importBookStockBulk(
  input: BookStockBulkImportInput,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiRequest("/imports/book-stock/bulk", {
    method: "POST",
    body: input,
  });
}

export function listBookStockImports(
  storeId: number,
): Promise<ActionResult<BookStockImportSummary[]>> {
  return apiRequest(`/imports/book-stock?storeId=${storeId}`);
}

export function getLatestBookStockForStore(
  storeId: number,
): Promise<ActionResult<LatestBookStockSummary | null>> {
  return apiRequest(`/stores/${storeId}/book-stock/latest`);
}
