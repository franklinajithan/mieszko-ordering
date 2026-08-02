import { parseUploadedFile } from "@/parsers/file-parser";
import { storeRepository } from "@/repositories";
import type { ErpType, FilePreview } from "@/types";
import {
  resolveStoreErpType,
  validateErpFileMatch,
} from "@/utils/erp-file-validation";

export type ParseImportFileInput = {
  buffer: Buffer;
  fileName: string;
  storeId?: number;
};

/** Parse FormData storeId; returns undefined when missing/invalid. */
export function parseOptionalStoreId(
  value: FormDataEntryValue | null,
): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function assertStoreFileErpMatch(input: {
  storeId?: number;
  headers: string[];
  fileName: string;
  detectFileErpType: (
    headers: string[],
    fileName: string,
  ) => ErpType | null;
}): Promise<void> {
  if (!input.storeId) return;
  const store = await storeRepository.getById(input.storeId);
  if (!store) return;
  const mismatch = validateErpFileMatch(
    input.detectFileErpType(input.headers, input.fileName),
    resolveStoreErpType(store.erpType),
  );
  if (mismatch) throw new Error(mismatch);
}

/** Generic spreadsheet parse (headers + sample rows). */
export async function parseImportSpreadsheet(
  input: ParseImportFileInput,
): Promise<FilePreview> {
  return parseUploadedFile(input.buffer, input.fileName);
}
