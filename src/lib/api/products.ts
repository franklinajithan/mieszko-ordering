import type {
  ActionResult,
  ImportResult,
  ProductImportBatchStatus,
  ProductImportProgress,
} from "@/types";
import { apiFormRequest, apiRequest } from "./client";

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
