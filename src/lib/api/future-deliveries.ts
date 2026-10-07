import type { ActionResult, ImportResult } from "@/types";
import { apiFormRequest, apiRequest } from "./client";

export type FutureUploadSummary = {
  fileName: string;
  source: string;
  importedAt: string;
  itemCount: number;
  totalQty: string;
};

export type FutureImportFileResult = ImportResult & {
  fileName: string;
  importedAt: string;
};

export type FutureImportResponse = {
  results: FutureImportFileResult[];
  errors: Array<{ fileName: string; error: string }>;
};

export function importFutureFiles(
  storeId: number,
  files: File[],
  source = "ocs",
  supplierId?: number,
): Promise<ActionResult<FutureImportResponse>> {
  const formData = new FormData();
  formData.set("storeId", String(storeId));
  formData.set("source", source);
  if (supplierId) formData.set("supplierId", String(supplierId));
  for (const file of files) {
    formData.append("files", file);
  }
  return apiFormRequest("/imports/future-deliveries", formData);
}

export function listFutureImports(
  storeId: number,
): Promise<ActionResult<FutureUploadSummary[]>> {
  return apiRequest(`/imports/future-deliveries?storeId=${storeId}`);
}

export function deleteFutureUpload(
  storeId: number,
  importedAt: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    importedAt,
  });
  return apiRequest(`/imports/future-deliveries?${params.toString()}`, {
    method: "DELETE",
  });
}
