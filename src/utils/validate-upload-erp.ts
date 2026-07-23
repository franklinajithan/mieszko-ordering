import type { ErpType } from "@/types";
import { readUploadFileHeaders } from "@/utils/read-upload-headers";
import {
  reportErpMismatch,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";

export async function checkUploadErpMismatch(
  file: File,
  storeErpType: ErpType,
  detectFileErpType: (headers: string[], fileName: string) => ErpType | null,
): Promise<string | null> {
  const headers = await readUploadFileHeaders(file);
  const fileErpType = detectFileErpType(headers, file.name);
  return validateErpFileMatch(fileErpType, storeErpType);
}

export async function rejectUploadIfErpMismatch(
  file: File,
  storeErpType: ErpType,
  detectFileErpType: (headers: string[], fileName: string) => ErpType | null,
): Promise<boolean> {
  const mismatch = await checkUploadErpMismatch(file, storeErpType, detectFileErpType);
  if (!mismatch) return false;
  reportErpMismatch(mismatch);
  return true;
}
