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

export type PeriodKey =
  | "period_1"
  | "period_2"
  | "period_3"
  | "previous_year";

export const PERIOD_KEYS: PeriodKey[] = [
  "period_1",
  "period_2",
  "period_3",
  "previous_year",
];

export type UploadType =
  | "book_stock"
  | "received_not_posted"
  | "future_delivery";

export type MappingType =
  | "store_product_code"
  | "barcode"
  | "supplier_code";

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

export type StockEventType =
  | "book_stock"
  | "received_not_posted"
  | "future_delivery";

export type ParsedRow = Record<string, string>;

export type FilePreview = {
  headers: string[];
  rows: ParsedRow[];
};

export type ErpType = "msp" | "glopos";

export const ERP_TYPES: ErpType[] = ["msp", "glopos"];

export const BOOK_STOCK_COLUMNS: Record<
  ErpType,
  { reference: string[]; quantity: string[]; label: string }
> = {
  msp: {
    reference: ["ID", "Id"],
    quantity: ["Qty", "QTY", "Quantity"],
    label: "MSP (ID + Qty)",
  },
  glopos: {
    reference: ["Item Code"],
    quantity: ["Current Stock"],
    label: "GloPOS (Item Code + Current Stock, pivoted)",
  },
};

export type SalesMappingType = "store_product_code" | "barcode";

export const KNOWN_PRICE_COLUMNS: Record<
  string,
  { reference: string[]; price: string[] }
> = {
  MM: {
    reference: ["Index", "index"],
    price: ["Net Price (Invoice)", "Net Price", "net price (invoice)"],
  },
  SP: {
    reference: ["Index", "index"],
    price: ["NetPrice", "Net Price", "netprice"],
  },
  WAB: {
    reference: ["Index", "index", "Code", "code"],
    price: ["NetPrice", "Net Price", "Price", "price"],
  },
};
