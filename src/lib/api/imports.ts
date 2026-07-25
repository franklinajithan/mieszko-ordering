import type { ActionResult, ImportResult } from "@/types";
import type {
  BookStockImportSummary,
  LatestBookStockSummary,
} from "@/services/apply-book-stock-to-order.service";
import type { PromoImportSummary } from "@/services/promo-import.service";
import type { RtcImportSummary } from "@/services/rtc-import.service";
import type { WastageImportSummary } from "@/services/wastage-import.service";
import { apiFormRequest, apiRequest } from "./client";

export function importDailySales(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  return apiFormRequest("/imports/daily-sales", formData);
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

export function listRtcImports(
  storeId: number,
): Promise<ActionResult<RtcImportSummary[]>> {
  return apiRequest(`/imports/rtc?storeId=${storeId}`);
}

export function importWastage(
  formData: FormData,
): Promise<ActionResult<ImportResult & { importId: number }>> {
  return apiFormRequest("/imports/wastage", formData);
}

export function listWastageImports(
  storeId: number,
): Promise<ActionResult<WastageImportSummary[]>> {
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
