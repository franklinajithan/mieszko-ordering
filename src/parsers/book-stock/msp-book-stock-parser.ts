import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { normalizeProductCode } from "@/parsers/products/product-file-parser";
import type { BookStockFileParseOptions } from "@/parsers/book-stock/glopos-stock-valuation-parser";

export const MSP_BOOK_STOCK_ID_COLUMN = "ID";
export const MSP_BOOK_STOCK_QTY_COLUMN = "QTY";

export type MspBookStockParseResult = {
  headers: string[];
  rows: ParsedRow[];
  referenceColumn: string;
  quantityColumn: string;
  duplicateRows: number;
  sourceRows: number;
};

type SpreadsheetBytes = ArrayBuffer | Buffer;

const ROW_PROGRESS_EVERY = 250;

async function yieldToMain(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function readWorkbook(bytes: SpreadsheetBytes): XLSX.WorkBook {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(bytes)) {
    return XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      cellStyles: false,
      cellNF: false,
      sheetStubs: false,
    });
  }
  return XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    cellStyles: false,
    cellNF: false,
    sheetStubs: false,
  });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value).trim();
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function findIdQtyHeaderRowIndex(grid: unknown[][]): number {
  for (let rowIndex = 0; rowIndex < Math.min(grid.length, 40); rowIndex += 1) {
    const values = (grid[rowIndex] ?? []).map(cellText).map(normHeader);
    const hasId = values.some((v) => v === "id");
    const hasQty = values.some((v) => v === "qty" || v === "quantity");
    // GloPOS product export: Name + Barcode + ID + QTY (not Stock Valuation).
    const hasName = values.some((v) => v === "name");
    if (hasId && hasQty && hasName) return rowIndex;
    if (hasId && hasQty && !values.some((v) => v === "item code")) return rowIndex;
  }
  return -1;
}

function findColumnIndex(headers: string[], patterns: string[]): number {
  for (let index = 0; index < headers.length; index += 1) {
    const header = normHeader(headers[index] ?? "");
    if (!header) continue;
    if (patterns.some((pattern) => header === pattern)) return index;
  }
  return -1;
}

function parsePlainNumber(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return null;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isMspIdQtyBookStockReport(
  headers: string[],
  fileName = "",
): boolean {
  if (/stock\s*valuation/i.test(fileName)) return false;
  const normalized = headers.map(normHeader).filter(Boolean);
  const hasId = normalized.some((h) => h === "id");
  const hasQty = normalized.some((h) => h === "qty" || h === "quantity");
  const hasItemCode = normalized.some((h) => h === "item code");
  const hasCurrentStock = normalized.some((h) => h.includes("current stock"));
  if (hasItemCode && hasCurrentStock) return false;
  return hasId && hasQty;
}

/**
 * Parse GloPOS book-stock product export (ID + QTY).
 * Duplicate IDs are summed before import.
 */
export async function parseMspIdQtyBookStockReport(
  buffer: SpreadsheetBytes,
  fileName: string,
  options?: BookStockFileParseOptions,
): Promise<MspBookStockParseResult> {
  const report = options?.onProgress;
  report?.({ phase: "workbook", processed: 0, total: 2 });
  await yieldToMain();

  const workbook = readWorkbook(buffer);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheets");

  const sheet = workbook.Sheets[sheetName];
  report?.({ phase: "workbook", processed: 1, total: 2 });
  await yieldToMain();

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  report?.({ phase: "workbook", processed: 2, total: 2 });

  const headerRowIndex = findIdQtyHeaderRowIndex(grid);
  if (headerRowIndex < 0) {
    throw new Error("Could not find GloPOS book stock header row (ID + QTY)");
  }

  const headerRow = grid[headerRowIndex] ?? [];
  const headers = headerRow.map(cellText);
  const colCount = headers.length;

  const idIndex = findColumnIndex(headers, ["id"]);
  const qtyIndex = findColumnIndex(headers, ["qty", "quantity"]);
  if (idIndex < 0 || qtyIndex < 0) {
    throw new Error("GloPOS book stock file is missing ID or QTY columns");
  }

  const aggregated = new Map<string, number>();
  let sourceRows = 0;
  const dataRowTotal = Math.max(0, grid.length - headerRowIndex - 1);
  report?.({ phase: "rows", processed: 0, total: dataRowTotal });

  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const rowOffset = rowIndex - headerRowIndex - 1;
    if (
      report &&
      (rowOffset === 0 ||
        rowOffset === dataRowTotal - 1 ||
        rowOffset % ROW_PROGRESS_EVERY === 0)
    ) {
      report({ phase: "rows", processed: rowOffset + 1, total: dataRowTotal });
      if (rowOffset > 0 && rowOffset % ROW_PROGRESS_EVERY === 0) {
        await yieldToMain();
      }
    }

    const rowValues = grid[rowIndex] ?? [];
    if (!rowValues.some((cell) => cellText(cell))) continue;

    const padded: string[] = [];
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      padded[colIndex] = cellText(rowValues[colIndex] ?? "");
    }

    const idRaw = padded[idIndex]?.trim() ?? "";
    const productCode = normalizeProductCode(idRaw);
    if (!productCode) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(productCode)) continue;

    const qty = parsePlainNumber(padded[qtyIndex]?.trim() ?? "");
    if (qty === null) continue;

    sourceRows += 1;
    aggregated.set(productCode, (aggregated.get(productCode) ?? 0) + qty);
  }

  const referenceColumn = MSP_BOOK_STOCK_ID_COLUMN;
  const quantityColumn = MSP_BOOK_STOCK_QTY_COLUMN;
  const rows: ParsedRow[] = [...aggregated.entries()].map(
    ([productCode, quantity], index) => ({
      [referenceColumn]: productCode,
      [quantityColumn]: String(quantity),
      __rowNumber: String(index + 2),
    }),
  );

  return {
    headers: [referenceColumn, quantityColumn],
    rows,
    referenceColumn,
    quantityColumn,
    duplicateRows: Math.max(0, sourceRows - aggregated.size),
    sourceRows,
  };
}

export async function tryParseMspIdQtyBookStockReport(
  buffer: SpreadsheetBytes,
  fileName: string,
  options?: BookStockFileParseOptions,
): Promise<MspBookStockParseResult | null> {
  try {
    return await parseMspIdQtyBookStockReport(buffer, fileName, options);
  } catch {
    return null;
  }
}
