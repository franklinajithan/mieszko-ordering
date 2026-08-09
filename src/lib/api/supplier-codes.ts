import type { ActionResult, ErpType } from "@/types";
import type {
  SupplierCodeImportResult,
  SupplierCodePreviewResult,
} from "@/services/supplier-code-import.service";
import type { SupplierCodeAssignment } from "@/services/supplier-code-import-prepare";
import { SUPPLIER_CODES_IMPORT_CHUNK_SIZE } from "@/lib/import-config";
import { apiFormRequest, apiRequest } from "./client";

export { SUPPLIER_CODES_IMPORT_CHUNK_SIZE };
export type { SupplierCodeImportResult, SupplierCodePreviewResult };

export async function parseSupplierCodeFile(
  formData: FormData,
): Promise<SupplierCodePreviewResult> {
  const result = await apiFormRequest<SupplierCodePreviewResult>(
    "/imports/supplier-codes/parse",
    formData,
  );
  if (!result.success) throw new Error(result.error);
  return result.data;
}

export type SupplierCodeImportChunkInput = {
  storeId: number;
  erpType: ErpType;
  fileName?: string;
  assignments: SupplierCodeAssignment[];
};

export function importSupplierCodeChunk(
  input: SupplierCodeImportChunkInput,
): Promise<ActionResult<SupplierCodeImportResult>> {
  return apiRequest("/imports/supplier-codes", { method: "POST", body: input });
}
