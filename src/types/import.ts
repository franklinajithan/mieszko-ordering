/** Shared import / spreadsheet primitives (no runtime config). */

export type ImportError = {
  rowNumber: number;
  reference: string | null;
  message: string;
};

export type ImportResult = {
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  invalidRows: number;
  duplicateRows?: number;
  errors: ImportError[];
};

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type ParsedRow = Record<string, string>;

export type FilePreview = {
  headers: string[];
  rows: ParsedRow[];
};

export type ErpType = "msp" | "glopos";

export type SalesMappingType = "store_product_code" | "barcode";

export type MappingType =
  | "store_product_code"
  | "barcode"
  | "supplier_code";

export type UploadType =
  | "book_stock"
  | "received_not_posted"
  | "future_delivery";

export type StockEventType =
  | "book_stock"
  | "received_not_posted"
  | "future_delivery";

export type PeriodKey = `period_${number}` | "previous_year";

export type PriceStatus =
  | "pending"
  | "complete"
  | "check_missing_code"
  | "check_missing_price"
  | "check_invalid_price";

export type PriceValidationStatus =
  | "valid"
  | "missing_code"
  | "missing_price"
  | "invalid_price";
