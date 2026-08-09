import type { BookStockFileParseResult } from "@/parsers/book-stock/book-stock-file-parser";
import { pivotBookStockByReference } from "@/services/book-stock/book-stock-pivot.service";
import type { ErpType, ParsedRow } from "@/types";

export type PreparedBookStockImport = {
  refCol: string;
  qtyCol: string;
  stockDate: string;
  duplicateRows: number;
  slimRows: Array<Record<string, string>>;
};

const STOCK_VALUATION_ITEM_CODE = "Item Code";
const STOCK_VALUATION_CURRENT_STOCK = "Current Stock";
const GLOPOS_ID = "ID";
const GLOPOS_QTY = "QTY";

/** Resolve product / qty columns from a parsed book-stock file. */
export function resolveBookStockColumns(
  parsed: Pick<
    BookStockFileParseResult,
    "referenceColumn" | "quantityColumn" | "gloposStockValuation"
  >,
  erpType: ErpType,
): { refCol: string; qtyCol: string } {
  if (parsed.referenceColumn && parsed.quantityColumn) {
    return { refCol: parsed.referenceColumn, qtyCol: parsed.quantityColumn };
  }
  if (parsed.gloposStockValuation || erpType === "msp") {
    return {
      refCol: STOCK_VALUATION_ITEM_CODE,
      qtyCol: STOCK_VALUATION_CURRENT_STOCK,
    };
  }
  return { refCol: GLOPOS_ID, qtyCol: GLOPOS_QTY };
}

/**
 * Pure row prep — safe for browser and server.
 * Dedicated parsers may already sum qty by product code (`preAggregated`).
 */
export function prepareBookStockImport(input: {
  parsed: BookStockFileParseResult;
  referenceColumn: string;
  quantityColumn: string;
  bookStockDate?: string;
}): PreparedBookStockImport {
  const { parsed, referenceColumn: refCol, quantityColumn: qtyCol } = input;

  let rows: ParsedRow[] = parsed.rows;
  let duplicateRows = parsed.duplicateRows ?? 0;

  if (!parsed.preAggregated && !parsed.gloposStockValuation) {
    const pivoted = pivotBookStockByReference(rows, refCol, qtyCol);
    rows = pivoted.rows;
    duplicateRows += pivoted.duplicateRows;
  }

  const slimRows = rows
    .map((row) => ({
      [refCol]: String(row[refCol] ?? "").trim(),
      [qtyCol]: String(row[qtyCol] ?? "").trim(),
      __rowNumber: String(row.__rowNumber ?? ""),
    }))
    .filter((row) => row[refCol] && row[qtyCol] !== "");

  return {
    refCol,
    qtyCol,
    stockDate: parsed.bookStockDate ?? input.bookStockDate ?? "",
    duplicateRows,
    slimRows,
  };
}
