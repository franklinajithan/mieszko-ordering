import type { SupplierCodeConflict } from "@/services/supplier-code-import-prepare";
import type { SupplierCodePreviewResult } from "@/services/supplier-code-import.service";

export type SupplierCodeImportProgress = {
  phase: "importing" | "done";
  fileName: string;
  storeName: string;
};

export type SupplierCodePreviewState = SupplierCodePreviewResult;

export type { SupplierCodeConflict };
