import type { ActionResult, FilePreview, ImportResult } from "@/types";
import type {
  BookStockImportSummary,
  LatestBookStockSummary,
} from "@/services/apply-book-stock-to-order.service";
import type { PromoImportSummary } from "@/services/promo-import.service";
import { RTC_IMPORT_CHUNK_SIZE } from "@/lib/rtc-import-constants";
import { apiFormRequest, apiRequest } from "./client";

export { RTC_IMPORT_CHUNK_SIZE };

/** Generic spreadsheet parse (headers + sample rows). Throws on failure. */
export async function parseImportFile(formData: FormData): Promise<FilePreview> {
  const result = await apiFormRequest<FilePreview>("/imports/parse", formData);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type DailySalesParseResult = FilePreview & {
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

export async function parseDailySalesFile(
  formData: FormData,
): Promise<DailySalesParseResult> {
  const result = await apiFormRequest<DailySalesParseResult>(
    "/imports/daily-sales/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

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

export async function parseRtcFile(formData: FormData): Promise<RtcParseResult> {
  const result = await apiFormRequest<RtcParseResult>(
    "/imports/rtc/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type WastageParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  wastageDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  skippedExcludedReasonRows?: number;
};

export async function parseWastageFile(
  formData: FormData,
): Promise<WastageParseResult> {
  const result = await apiFormRequest<WastageParseResult>(
    "/imports/wastage/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type DailySalesImportChunkInput = {
  storeId: number;
  mappingType?: "store_product_code" | "barcode";
  productColumn: string;
  quantityColumn: string;
  manualSalesDate: string;
  fileName?: string;
  rows: Array<Record<string, string>>;
};

export function importDailySalesChunk(
  input: DailySalesImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/imports/daily-sales", { method: "POST", body: input });
}

export function deleteDailySalesUpload(
  storeId: number,
  salesDate: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    salesDate,
  });
  return apiRequest(`/imports/daily-sales?${params.toString()}`, {
    method: "DELETE",
  });
}

export function listDailySalesSummaries(
  storeId: number,
): Promise<
  ActionResult<
    Array<{
      salesDate: string;
      itemCount: number;
      totalSoldQty: string;
      lastUpdated: string;
    }>
  >
> {
  return apiRequest(`/imports/daily-sales?storeId=${storeId}`);
}

export function importSupplierPrices(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  return apiFormRequest("/imports/supplier-prices", formData);
}

export function importBookStock(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiFormRequest("/imports/book-stock", formData);
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

export type RtcImportChunkInput = {
  storeId: number;
  rtcDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName?: string;
  rows: Array<Record<string, string>>;
};

export function importRtcChunk(
  input: RtcImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/imports/rtc", { method: "POST", body: input });
}

export function matchRtcBarcodes(input: {
  storeId: number;
  barcodes: string[];
}): Promise<
  ActionResult<
    Array<{
      fileBarcode: string;
      storeProductCode: string;
      productName: string | null;
    }>
  >
> {
  return apiRequest("/imports/rtc/match-barcodes", {
    method: "POST",
    body: input,
  });
}

export function deleteRtcUpload(
  storeId: number,
  rtcDate: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    rtcDate,
  });
  return apiRequest(`/imports/rtc?${params.toString()}`, {
    method: "DELETE",
  });
}

export function listRtcSummaries(
  storeId: number,
): Promise<
  ActionResult<
    Array<{
      rtcDate: string;
      itemCount: number;
      totalRtcQty: string;
      lastUpdated: string;
    }>
  >
> {
  return apiRequest(`/imports/rtc?storeId=${storeId}`);
}

export function importWastage(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiFormRequest("/imports/wastage", formData);
}

export function deleteWastageUpload(
  storeId: number,
  wastageDate: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    wastageDate,
  });
  return apiRequest(`/imports/wastage?${params.toString()}`, {
    method: "DELETE",
  });
}

export function listWastageSummaries(
  storeId: number,
): Promise<
  ActionResult<
    Array<{
      wastageDate: string;
      itemCount: number;
      totalWastageQty: string;
      lastUpdated: string;
    }>
  >
> {
  return apiRequest(`/imports/wastage?storeId=${storeId}`);
}

export function importPromo(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiFormRequest("/imports/promo", formData);
}

export function listPromoImports(
  storeId: number,
): Promise<ActionResult<PromoImportSummary[]>> {
  return apiRequest(`/imports/promo?storeId=${storeId}`);
}
