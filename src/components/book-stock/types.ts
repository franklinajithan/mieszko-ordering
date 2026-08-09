export type BookStockImportProgress = {
  processed: number;
  total: number;
  fileName: string;
  storeName: string;
  done: boolean;
};

export type BookStockPreviewState = {
  headers: string[];
  rows: Array<Record<string, string>>;
  referenceColumn?: string;
  quantityColumn?: string;
  bookStockDate?: string;
  duplicateRows?: number;
  totalProducts?: number;
};

export type BookStockUploadSummary = {
  bookStockDate: string;
  importedAt: string;
  itemCount: number;
  totalBookStockQty: string;
};
