export const BOOK_STOCK_IMPORT_CHUNK_SIZE =
  Number(process.env.NEXT_PUBLIC_BOOK_STOCK_IMPORT_CHUNK_SIZE) || 2000;

/** Max rows for a single JSON bulk request (larger files use chunked import). */
export const BOOK_STOCK_BULK_MAX_ROWS =
  Number(process.env.NEXT_PUBLIC_BOOK_STOCK_BULK_MAX_ROWS) || 2500;

export const BOOK_STOCK_INSERT_BATCH_SIZE = 2000;
export const BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE = 5000;
