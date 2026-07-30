import type { FilePreview } from "@/types";

export type Store = { id: number; name: string; code: string; erpType: string };

export type WastagePreviewState = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  wastageDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  skippedExcludedReasonRows?: number;
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedCodes?: string[];
};

export type WastageSavedRow = {
  id: string;
  storeId: string;
  storeName: string;
  wastageDate: string;
  productCount: number;
  totalWastageQty: string;
  lastUpdated: Date;
};
