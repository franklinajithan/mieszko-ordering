export type Store = { id: number; name: string; erpType: string };

export type PreviewState = {
  headers: string[];
  rows: Record<string, string>[];
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

export type ImportProgress = {
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

export type DailySalesDateSummary = {
  salesDate: string;
  itemCount: number;
  totalSoldQty: string;
  lastUpdated: string;
};