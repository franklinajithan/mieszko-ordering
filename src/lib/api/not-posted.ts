import type { ActionResult, ImportResult } from "@/types";
import { apiFormRequest, apiRequest } from "./client";

export type NotPostedUploadSummary = {
  fileName: string;
  importedAt: string;
  itemCount: number;
  totalQty: string;
};

export type NotPostedImportFileResult = ImportResult & {
  fileName: string;
  importedAt: string;
};

export type NotPostedImportResponse = {
  results: NotPostedImportFileResult[];
  errors: Array<{ fileName: string; error: string }>;
};

export function importNotPostedFiles(
  storeId: number,
  files: File[],
): Promise<ActionResult<NotPostedImportResponse>> {
  const formData = new FormData();
  formData.set("storeId", String(storeId));
  for (const file of files) {
    formData.append("files", file);
  }
  return apiFormRequest("/imports/not-posted", formData);
}

export function listNotPostedImports(
  storeId: number,
): Promise<ActionResult<NotPostedUploadSummary[]>> {
  return apiRequest(`/imports/not-posted?storeId=${storeId}`);
}

export function deleteNotPostedUpload(
  storeId: number,
  importedAt: string,
): Promise<ActionResult<void>> {
  const params = new URLSearchParams({
    storeId: String(storeId),
    importedAt,
  });
  return apiRequest(`/imports/not-posted?${params.toString()}`, {
    method: "DELETE",
  });
}
