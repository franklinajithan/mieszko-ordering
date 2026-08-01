import type { ActionResult, ImportResult } from "@/types";
import type {
  Product,
  ProductBarcode,
  ProductCatalogFilters,
  ProductCatalogResult,
  ProductSupplierMapping,
} from "@/types/product";
import { apiRequest } from "@/lib/api/client";


export const PRODUCT_IMPORT_CHUNK_SIZE = Number(process.env.NEXT_PUBLIC_PRODUCT_IMPORT_CHUNK_SIZE) || 2000;

export function getProduct(id: number): Promise<ActionResult<Product>> {
  return apiRequest(`/products/${id}`);
}

export function listProductBarcodes(
  productId: number,
  storeId?: number,
): Promise<ActionResult<ProductBarcode[]>> {
  const params = storeId ? `?storeId=${storeId}` : "";
  return apiRequest(`/products/${productId}/barcodes${params}`);
}

export function listProductSupplierMappings(
  productId: number,
): Promise<ActionResult<ProductSupplierMapping[]>> {
  return apiRequest(`/products/${productId}/supplier-codes`);
}

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
  storeId: number;
  barcode: unknown;
}): Promise<ActionResult<{ id: number }>> {
  return apiRequest(`/products/${input.productId}/barcodes`, {
    method: "POST",
    body: { storeId: input.storeId, barcode: input.barcode },
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

export type ProductImportChunkInput = {
  storeId: number;
  codeColumn: string;
  nameColumn: string;
  departmentColumn?: string;
  barcodeColumn?: string;
  retailPriceColumn?: string;
  shareAcrossMspStores?: boolean;
  rows: Array<Record<string, string>>;
};

/** Import one chunk of product rows (max PRODUCT_IMPORT_CHUNK_SIZE). */
export function importProductChunk(
  input: ProductImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/products/import", { method: "POST", body: input });
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
