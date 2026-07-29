import type { FilePreview } from "@/types";

export type Store = { id: number; name: string; code: string; erpType: string };

export type RtcPreviewState = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  rtcDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedBarcodes?: string[];
};

export type RtcSavedRow = {
  id: string;
  storeId: string;
  storeName: string;
  rtcDate: string;
  productCount: number;
  totalRtcQty: string;
  lastUpdated: Date;
};

export type RtcImportProgress = {
  processed: number;
  total: number;
  fileName: string;
  storeName: string;
  done: boolean;
};
