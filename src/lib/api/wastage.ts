import type { ActionResult, FilePreview, ImportResult } from "@/types";
import { WASTAGE_IMPORT_CHUNK_SIZE } from "@/lib/wastage-import-constants";
import { apiFormRequest, apiRequest } from "./client";

export { WASTAGE_IMPORT_CHUNK_SIZE };

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

export type WastageImportChunkInput = {
  storeId: number;
  wastageDate: string;
  referenceColumn: string;
  quantityColumn: string;
  fileName?: string;
  rows: Array<Record<string, string>>;
};

export function importWastageChunk(
  input: WastageImportChunkInput,
): Promise<ActionResult<ImportResult>> {
  return apiRequest("/imports/wastage", { method: "POST", body: input });
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
