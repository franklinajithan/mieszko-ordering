import type { ActionResult, FilePreview, ImportResult } from "@/types";
import type { BookStockUploadSummary } from "@/services/book-stock/apply-book-stock-to-order.service";
import { BOOK_STOCK_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiFormRequest, apiRequest } from "./client";

export { BOOK_STOCK_IMPORT_CHUNK_SIZE };

export type BookStockParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  bookStockDate?: string;
  duplicateRows?: number;
  totalProducts?: number;
};

export type LatestBookStockSummary = BookStockUploadSummary;
export type BookStockImportSummary = BookStockUploadSummary;
export type BookStockDateSummary = BookStockUploadSummary;

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

export type BookStockImportChunkInput = {
  storeId: number;
  bookStockDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName: string;
  importedAt?: string;
  rows: Array<Record<string, string>>;
};

export function importBookStockChunk(
  input: BookStockImportChunkInput,
): Promise<ActionResult<ImportResult & { importedAt: string }>> {
  return apiRequest("/imports/book-stock", { method: "POST", body: input });
}

export function listBookStockImports(
  storeId: number,
): Promise<ActionResult<BookStockUploadSummary[]>> {
  return apiRequest(`/imports/book-stock?storeId=${storeId}`);
}

export function deleteBookStockUpload(
  storeId: number,
  importedAt: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    importedAt,
  });
  return apiRequest(`/imports/book-stock?${params.toString()}`, {
    method: "DELETE",
  });
}

export function getLatestBookStockForStore(
  storeId: number,
): Promise<ActionResult<LatestBookStockSummary | null>> {
  return apiRequest(`/stores/${storeId}/book-stock/latest`);
}
