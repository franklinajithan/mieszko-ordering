import type { FilePreview } from "@/types/import";

export type PromoPreviewState = FilePreview & {
  referenceColumn?: string;
  quantityColumn?: string;
  promoDate?: string;
  duplicateRows?: number;
  mappingType?: "store_product_code" | "barcode";
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedCodes?: string[];
};

export type PromoSavedRow = {
  id: string;
  storeId: string;
  storeName: string;
  promoDate: string;
  productCount: number;
  totalPromoQty: string;
  lastUpdated: Date;
};

export type PromoImportProgress = {
  processed: number;
  total: number;
  fileName: string;
  storeName: string;
  done: boolean;
};
