import type { ActionResult, ImportResult } from "@/types";
import type { SupplierPriceUploadSummary } from "@/services/supplier-prices/supplier-price-import.service";
import { SUPPLIER_PRICES_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiFormRequest, apiRequest } from "./client";

export type { SupplierPriceUploadSummary };
export { SUPPLIER_PRICES_IMPORT_CHUNK_SIZE };

export function importSupplierPrices(
  formData: FormData,
): Promise<ActionResult<ImportResult>> {
  return apiFormRequest("/imports/supplier-prices", formData);
}

export type SupplierPriceImportChunkInput = {
  supplierId: number;
  referenceColumn: string;
  priceColumn: string;
  caseSizeColumn?: string;
  effectiveDate: string;
  validUntil?: string;
  importedAt?: string;
  fileName: string;
  rows: Array<Record<string, string>>;
};

export function importSupplierPriceChunk(
  input: SupplierPriceImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/imports/supplier-prices", {
    method: "POST",
    body: input,
  });
}

export function listSupplierPriceUploads(): Promise<
  ActionResult<SupplierPriceUploadSummary[]>
> {
  return apiRequest("/imports/supplier-prices");
}

export function deleteSupplierPriceUpload(
  supplierId: number,
  importedAt: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    supplierId: String(supplierId),
    importedAt,
  });
  return apiRequest(`/imports/supplier-prices?${params.toString()}`, {
    method: "DELETE",
  });
}
