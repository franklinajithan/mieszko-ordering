/**
 * Browser API client. These functions mirror the legacy server-action
 * signatures and return the same `{ success, data, error }` envelope, so call
 * sites only need to swap the import path (`@/app/actions` -> `@/lib/api`).
 *
 * Under the hood every call goes through `apiRequest` / `apiFormRequest`, which
 * target the same-origin `/api` routes by default or `NEXT_PUBLIC_API_URL`
 * when set (e.g. a future FastAPI backend).
 */
import type {
  ActionResult,
  FilePreview,
  ImportResult,
  ProductImportBatchStatus,
  ProductImportProgress,
} from "@/types";
import type {
  BookStockImportSummary,
  LatestBookStockSummary,
} from "@/services/apply-book-stock-to-order.service";
import type { PromoImportSummary } from "@/services/promo-import.service";
import type { RtcImportSummary } from "@/services/rtc-import.service";
import type { WastageImportSummary } from "@/services/wastage-import.service";
import { apiFormRequest, apiRequest } from "./client";

export { API_BASE_URL, apiFormRequest, apiRequest } from "./client";

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
export function createStore(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/stores", { method: "POST", body: input });
}

export function updateStore(
  input: { id: number } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/stores/${id}`, { method: "PATCH", body });
}

export function toggleStoreActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  return apiRequest(`/stores/${id}`, { method: "PATCH", body: { isActive } });
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
export function createSupplier(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/suppliers", { method: "POST", body: input });
}

export function updateSupplier(
  input: { id: number } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/suppliers/${id}`, { method: "PATCH", body });
}

export function toggleSupplierActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  return apiRequest(`/suppliers/${id}`, {
    method: "PATCH",
    body: { isActive },
  });
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------
export function createDepartment(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return apiRequest("/departments", { method: "POST", body: input });
}

export function updateDepartmentDetails(
  input: { id: string } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/departments/${id}`, { method: "PATCH", body });
}

export function toggleDepartmentActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  return apiRequest(`/departments/${id}`, {
    method: "PATCH",
    body: { isActive },
  });
}

export function importDepartments(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  return apiFormRequest("/departments/import", formData);
}

// ---------------------------------------------------------------------------
// Products & mappings
// ---------------------------------------------------------------------------
export function createProduct(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/products", { method: "POST", body: input });
}

export function updateProduct(
  input: { id: number } & Record<string, unknown>,
): Promise<ActionResult> {
  const { id, ...body } = input;
  return apiRequest(`/products/${id}`, { method: "PATCH", body });
}

export function assignOrderDepartment(input: {
  productId: number;
  orderDepartment: string | null;
}): Promise<ActionResult> {
  return apiRequest(`/products/${input.productId}/order-department`, {
    method: "PATCH",
    body: { orderDepartment: input.orderDepartment },
  });
}

export function addStoreProduct(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/store-products", { method: "POST", body: input });
}

export function addBarcode(input: {
  productId: number;
  barcode: unknown;
}): Promise<ActionResult<{ id: number }>> {
  return apiRequest(`/products/${input.productId}/barcodes`, {
    method: "POST",
    body: { barcode: input.barcode },
  });
}

export function addSupplierProductMapping(input: {
  productId: number;
  supplierId: unknown;
  supplierCode: unknown;
  isActive?: boolean;
}): Promise<ActionResult<{ id: number }>> {
  const { productId, ...body } = input;
  return apiRequest(`/products/${productId}/supplier-codes`, {
    method: "POST",
    body,
  });
}

export function importProducts(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  return apiFormRequest("/products/import", formData);
}

export function beginProductImport(
  formData: FormData,
): Promise<ActionResult<ProductImportProgress>> {
  return apiFormRequest("/products/import/begin", formData);
}

export function beginProductImportFromRows(
  input: unknown,
): Promise<ActionResult<ProductImportProgress>> {
  return apiRequest("/products/import/begin-from-rows", {
    method: "POST",
    body: input,
  });
}

export function runProductImportBatch(input: {
  jobId: string;
  batchIndex: number;
}): Promise<ActionResult<ProductImportBatchStatus>> {
  return apiRequest("/products/import/batch", { method: "POST", body: input });
}

export function finishProductImport(
  jobId: string,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/products/import/finish", {
    method: "POST",
    body: { jobId },
  });
}

// ---------------------------------------------------------------------------
// Uploads / previews (throw on failure — matches legacy server-action behaviour)
// ---------------------------------------------------------------------------
export async function previewUpload(formData: FormData): Promise<FilePreview> {
  const result = await apiFormRequest<FilePreview>(
    "/uploads/preview",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export async function previewDailySalesUpload(
  formData: FormData,
): Promise<
  FilePreview & {
    productColumn?: string;
    quantityColumn?: string;
    manualSalesDate?: string;
    periodLabel?: string | null;
    duplicateRows?: number;
  }
> {
  const result = await apiFormRequest<
    FilePreview & {
      productColumn?: string;
      quantityColumn?: string;
      manualSalesDate?: string;
      periodLabel?: string | null;
      duplicateRows?: number;
    }
  >("/uploads/preview-daily-sales", formData);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export function createOrder(
  input: unknown,
): Promise<ActionResult<{ id: number }>> {
  return apiRequest("/orders", { method: "POST", body: input });
}

export function updateOrderPeriods(input: {
  orderId: number;
  periods: Array<{ periodKey: string; startDate: string; endDate: string }>;
}): Promise<ActionResult> {
  return apiRequest(`/orders/${input.orderId}/periods`, {
    method: "PUT",
    body: { periods: input.periods },
  });
}

export function updateOrderSelectedSuppliers(input: {
  orderId: number;
  supplierIds: number[];
}): Promise<ActionResult> {
  return apiRequest(`/orders/${input.orderId}/suppliers`, {
    method: "PUT",
    body: { supplierIds: input.supplierIds },
  });
}

export function calculateOrderAction(input: {
  orderId: number;
}): Promise<ActionResult> {
  return apiRequest(`/orders/${input.orderId}/calculate`, { method: "POST" });
}

export function updateFinalOrderQuantity(input: {
  orderItemId: number;
  finalOrderQty: string;
}): Promise<ActionResult> {
  return apiRequest(`/order-items/${input.orderItemId}`, {
    method: "PATCH",
    body: { finalOrderQty: input.finalOrderQty },
  });
}

export function uploadOrderStockFile(
  formData: FormData,
): Promise<ActionResult<ImportResult & { uploadId: number }>> {
  const orderId = String(formData.get("orderId") ?? "");
  return apiFormRequest(`/orders/${orderId}/stock-upload`, formData);
}

export function applyStoredBookStockToOrder(input: {
  orderId: number;
  importId: number;
}): Promise<ActionResult<ImportResult & { uploadId: number }>> {
  return apiRequest(`/orders/${input.orderId}/apply-book-stock`, {
    method: "POST",
    body: { importId: input.importId },
  });
}

export function exportOrder(input: {
  orderId: number;
}): Promise<ActionResult<{ base64: string; fileName: string }>> {
  return apiRequest(`/orders/${input.orderId}/export`, { method: "POST" });
}

export function exportHoDairyWithTemplate(
  formData: FormData,
): Promise<ActionResult<{ base64: string; fileName: string }>> {
  const orderId = String(formData.get("orderId") ?? "");
  return apiFormRequest(`/orders/${orderId}/export-ho-dairy`, formData);
}
