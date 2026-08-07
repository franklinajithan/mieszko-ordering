import { parseAllRows } from "@/parsers/file-parser";
import {
  tryParseGloposStockValuationReport,
  type BookStockFileParseOptions,
  type GloposStockValuationParseResult,
} from "@/parsers/glopos-stock-valuation-parser";

export type { BookStockFileParseProgress, BookStockFileParseOptions } from "@/parsers/glopos-stock-valuation-parser";
import type { ParsedRow } from "@/types";

function toNodeBuffer(buffer: ArrayBuffer | Buffer): Buffer {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(buffer)) {
    return buffer;
  }
  return Buffer.from(buffer as ArrayBuffer);
}

export type BookStockFileParseResult = {
  headers: string[];
  rows: ParsedRow[];
  referenceColumn?: string;
  quantityColumn?: string;
  bookStockDate?: string;
  duplicateRows?: number;
  gloposStockValuation: boolean;
};

export async function parseBookStockFileBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
  options?: BookStockFileParseOptions,
): Promise<BookStockFileParseResult> {
  const glopos = await tryParseGloposStockValuationReport(buffer, fileName, options);
  if (glopos) return fromGloposStockValuation(glopos);

  const nodeBuffer = toNodeBuffer(buffer);
  options?.onProgress?.({ phase: "workbook", processed: 0, total: 1 });
  const flat = await parseAllRows(nodeBuffer, fileName);
  options?.onProgress?.({
    phase: "rows",
    processed: flat.rows.length,
    total: Math.max(1, flat.rows.length),
  });
  return {
    headers: flat.headers,
    rows: flat.rows,
    gloposStockValuation: false,
  };
}

function fromGloposStockValuation(
  parsed: GloposStockValuationParseResult,
): BookStockFileParseResult {
  return {
    headers: parsed.headers,
    rows: parsed.rows,
    referenceColumn: parsed.referenceColumn,
    quantityColumn: parsed.quantityColumn,
    bookStockDate: parsed.bookStockDate ?? undefined,
    duplicateRows: parsed.duplicateRows,
    gloposStockValuation: true,
  };
}
