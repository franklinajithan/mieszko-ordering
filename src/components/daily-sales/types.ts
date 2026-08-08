export type DailySalesPreviewState = {
  headers: string[];
  rows: Record<string, string>[];
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

export type DailySalesImportProgress = {
  processed: number;
  total: number;
  fileName: string;
  storeName: string;
  done: boolean;
};

export type DailySalesUploadRow = {
  id: string;
  storeId: string;
  storeName: string;
  salesDate: string;
  matchedRows: number;
  totalSoldQty: string;
  uploadedAt: Date;
};
