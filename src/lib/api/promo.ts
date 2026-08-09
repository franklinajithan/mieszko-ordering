import type { ActionResult, FilePreview, ImportResult } from "@/types";
import { PROMO_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiFormRequest, apiRequest } from "./client";

export { PROMO_IMPORT_CHUNK_SIZE };

export type PromoParseResult = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  promoDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedCodes?: string[];
};

export async function parsePromoFile(
  formData: FormData,
): Promise<PromoParseResult> {
  const result = await apiFormRequest<PromoParseResult>(
    "/imports/promo/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type PromoImportChunkInput = {
  storeId: number;
  promoDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName?: string;
  rows: Array<Record<string, string>>;
};

export function importPromoChunk(
  input: PromoImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/imports/promo", { method: "POST", body: input });
}

export function deletePromoUpload(
  storeId: number,
  promoDate: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    promoDate,
  });
  return apiRequest(`/imports/promo?${params.toString()}`, {
    method: "DELETE",
  });
}

export function listPromoSummaries(
  storeId: number,
): Promise<
  ActionResult<
    Array<{
      promoDate: string;
      itemCount: number;
      totalPromoQty: string;
      lastUpdated: string;
    }>
  >
> {
  return apiRequest(`/imports/promo?storeId=${storeId}`);
}
