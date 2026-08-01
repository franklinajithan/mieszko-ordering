import type { ActionResult, ImportResult } from "@/types";
import type {
  BookStockImportSummary,
  LatestBookStockSummary,
} from "@/services/apply-book-stock-to-order.service";
import type { PromoImportSummary } from "@/services/promo-import.service";
import { apiFormRequest, apiRequest } from "./client";


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

export function importRtc(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiFormRequest("/imports/rtc", formData);
}

export function beginRtcImport(
  formData: FormData,
): Promise<
  ActionResult<{
    jobId: string;
    totalRows: number;
    fileName: string;
    storeName: string;
    batchSize: number;
    importId: number;
  }>
> {
  return apiFormRequest("/imports/rtc/begin", formData);
}

export function runRtcImportBatch(input: {
  jobId: string;
  batchIndex: number;
}): Promise<
  ActionResult<{
    processed: number;
    total: number;
    done: boolean;
    result: ImportResult;
    importId: number;
  }>
> {
  return apiRequest("/imports/rtc/batch", {
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
