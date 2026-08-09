import { parseAllRows } from "@/parsers/file-parser";
import {
  parseGloposStockValuationReport,
  tryParseGloposStockValuationReport,
  type BookStockFileParseOptions,
  type GloposStockValuationParseResult,
} from "@/parsers/glopos-stock-valuation-parser";
import {
  parseMspIdQtyBookStockReport,
  tryParseMspIdQtyBookStockReport,
  type MspBookStockParseResult,
} from "@/parsers/msp-book-stock-parser";

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
  /** Stock Valuation (Detail) Item Code + Current Stock */
  gloposStockValuation: boolean;
  /** Parser already summed qty by product code */
  preAggregated: boolean;
};

export async function parseBookStockFileBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
  options?: BookStockFileParseOptions,
): Promise<BookStockFileParseResult> {
  const isStockValuationName = /stock\s*valuation/i.test(fileName);

  // Stock Valuation (Detail) — Item Code + Current Stock
  if (isStockValuationName) {
    const parsed = await parseGloposStockValuationReport(buffer, fileName, options);
    if (!parsed.rows.length) {
      throw new Error(
        "No Item Code / Current Stock rows found in this Stock Valuation file.",
      );
    }
    return fromStockValuation(parsed);
  }

  const stockValuation = await tryParseGloposStockValuationReport(
    buffer,
    fileName,
    options,
  );
  if (stockValuation?.rows.length) return fromStockValuation(stockValuation);

  // GloPOS product export — ID + QTY
  const msp = await tryParseMspIdQtyBookStockReport(buffer, fileName, options);
  if (msp?.rows.length) return fromMspIdQty(msp);

  // Filename hints like BK.xlsx — try GloPOS ID/QTY parser with clearer errors
  if (/^bk\b|\bbook\s*stock\b/i.test(fileName)) {
    const parsed = await parseMspIdQtyBookStockReport(buffer, fileName, options);
    if (!parsed.rows.length) {
      throw new Error("No ID / QTY rows found in this GloPOS book stock file.");
    }
    return fromMspIdQty(parsed);
  }

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
    preAggregated: false,
  };
}

function fromStockValuation(
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
    preAggregated: true,
  };
}

function fromMspIdQty(parsed: MspBookStockParseResult): BookStockFileParseResult {
  return {
    headers: parsed.headers,
    rows: parsed.rows,
    referenceColumn: parsed.referenceColumn,
    quantityColumn: parsed.quantityColumn,
    duplicateRows: parsed.duplicateRows,
    gloposStockValuation: false,
    preAggregated: true,
  };
}
