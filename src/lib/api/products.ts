import type { ActionResult, ImportResult } from "@/types";
import type {
  Product,
  ProductBarcode,
  ProductCatalogFilters,
  ProductCatalogResult,
  ProductImportBatchStatus,
  ProductImportProgress,
  ProductSupplierMapping,
} from "@/types/product";
import { apiFormRequest, apiRequest } from "./client";

export function getProduct(id: number): Promise<ActionResult<Product>> {
  return apiRequest(`/products/${id}`);
}

export function listProductBarcodes(
  productId: number,
): Promise<ActionResult<ProductBarcode[]>> {
  return apiRequest(`/products/${productId}/barcodes`);
}

export function listProductSupplierMappings(
  productId: number,
): Promise<ActionResult<ProductSupplierMapping[]>> {
  return apiRequest(`/products/${productId}/supplier-codes`);
}

export function createProduct(  input: unknown,
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
  orderDepartment: number | null;
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

export function listProductCatalog(
  filters: ProductCatalogFilters,
): Promise<ActionResult<ProductCatalogResult>> {
  const params = new URLSearchParams();
  params.set("storeId", String(filters.storeId));
  if (filters.department) params.set("department", filters.department);
  if (filters.isActive === false) params.set("active", "false");
  else if (filters.isActive === undefined) params.set("active", "all");
  if (filters.search) params.set("search", filters.search);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  return apiRequest(`/products/catalog?${params.toString()}`);
}