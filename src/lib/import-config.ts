/**
 * Shared import tuning + spreadsheet column labels.
 * Chunk sizes are overridable via NEXT_PUBLIC_* so browser and API stay in sync.
 */

import type { ErpType } from "@/types/import";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const IMPORT_CHUNK = {
  products: envInt("NEXT_PUBLIC_PRODUCT_IMPORT_CHUNK_SIZE", 2000),
  dailySales: envInt("NEXT_PUBLIC_DAILY_SALES_IMPORT_CHUNK_SIZE", 2000),
  bookStock: envInt("NEXT_PUBLIC_BOOK_STOCK_IMPORT_CHUNK_SIZE", 2000),
  bookStockBulkMax: envInt("NEXT_PUBLIC_BOOK_STOCK_BULK_MAX_ROWS", 2500),
  rtc: envInt("NEXT_PUBLIC_RTC_IMPORT_CHUNK_SIZE", 500),
  wastage: envInt("NEXT_PUBLIC_WASTAGE_IMPORT_CHUNK_SIZE", 500),
} as const;

/** Server-only batch sizes for book-stock DB work (not exposed to the browser). */
export const BOOK_STOCK_INSERT_BATCH_SIZE = 2000;
export const BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE = 5000;

/** Common spreadsheet column labels used by MSP/GloPOS parsers. */
export const IMPORT_COLUMNS = {
  itemCode: "Item Code",
  qty: "Qty",
} as const;

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

// Named aliases — keep call sites readable without changing every symbol.
export const PRODUCT_IMPORT_CHUNK_SIZE = IMPORT_CHUNK.products;
export const DAILY_SALES_IMPORT_CHUNK_SIZE = IMPORT_CHUNK.dailySales;
export const BOOK_STOCK_IMPORT_CHUNK_SIZE = IMPORT_CHUNK.bookStock;
export const BOOK_STOCK_BULK_MAX_ROWS = IMPORT_CHUNK.bookStockBulkMax;
export const RTC_IMPORT_CHUNK_SIZE = IMPORT_CHUNK.rtc;
export const WASTAGE_IMPORT_CHUNK_SIZE = IMPORT_CHUNK.wastage;

export const RTC_ITEM_CODE_COLUMN = IMPORT_COLUMNS.itemCode;
export const WASTAGE_ITEM_CODE_COLUMN = IMPORT_COLUMNS.itemCode;
export const WASTAGE_QTY_COLUMN = IMPORT_COLUMNS.qty;
