import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { normalizeProductCode } from "@/parsers/product-file-parser";

export const STOCK_VALUATION_ITEM_CODE_COLUMN = "Item Code";
export const STOCK_VALUATION_CURRENT_STOCK_COLUMN = "Current Stock";

export type GloposStockValuationParseResult = {
  headers: string[];
  rows: ParsedRow[];
  referenceColumn: string;
  quantityColumn: string;
  bookStockDate: string | null;
  duplicateRows: number;
  sourceRows: number;
};

export type BookStockFileParseProgress = {
  phase: "workbook" | "rows";
  processed: number;
  total: number;
};

export type BookStockFileParseOptions = {
  onProgress?: (progress: BookStockFileParseProgress) => void;
};

const ROW_PROGRESS_EVERY = 250;

type SpreadsheetBytes = ArrayBuffer | Buffer;

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

function isoFromDmy(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseBookStockDateFromMeta(values: string[]): string | null {
  for (const value of values) {
    if (!value) continue;
    const created = value.match(
      /created\s*on\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i,
    );
    if (created) {
      const [, dd, mm, yyyy] = created;
      return isoFromDmy(dd, mm, yyyy);
    }
  }
  return null;
}

function parseBookStockDateFromFileName(fileName: string): string | null {
  const match = fileName.match(/_(\d{4})(\d{2})(\d{2})_/);
  if (match) {
    const [, yyyy, mm, dd] = match;
    return isoFromDmy(dd, mm, yyyy);
  }
  return null;
}

function findSheetName(workbook: XLSX.WorkBook): string | null {
  const byName = workbook.SheetNames.find((name) =>
    /stockvaluation/i.test(name.replace(/\s+/g, "")),
  );
  return byName ?? workbook.SheetNames[0] ?? null;
}

function findItemCodeHeaderRowIndex(grid: unknown[][]): number {
  for (let rowIndex = 0; rowIndex < Math.min(grid.length, 80); rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const values = row.map(cellText).map(normHeader);
    const hasItemCode = values.some((v) => v === "item code");
    const hasCurrentStock = values.some((v) => v.includes("current stock"));
    if (hasItemCode && hasCurrentStock) return rowIndex;
  }
  return -1;
}

function findColumnIndex(headers: string[], patterns: string[]): number {
  for (let index = 0; index < headers.length; index += 1) {
    const header = normHeader(headers[index] ?? "");
    if (!header) continue;
    if (patterns.some((pattern) => header === pattern || header.includes(pattern))) {
      return index;
    }
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

function isMetaDataRow(itemCode: string, itemName: string): boolean {
  const code = itemCode.trim();
  if (!code) return true;

  const codeLower = code.toLowerCase();
  const nameLower = itemName.trim().toLowerCase();
  if (codeLower.startsWith("total") || codeLower.startsWith("grand total")) return true;
  if (nameLower.startsWith("total") || nameLower.startsWith("grand total")) return true;

  // Section headers like "GROCERY - Standard VAT" are not product codes.
  if (!/^[A-Za-z0-9._-]+$/.test(code)) return true;

  return false;
}

export function isGloposStockValuationReport(headers: string[], fileName: string): boolean {
  if (/stock\s*valuation/i.test(fileName)) return true;
  const text = headers.map(normHeader).join(" | ");
  return text.includes("item code") && text.includes("current stock");
}

export async function tryParseGloposStockValuationReport(
  buffer: SpreadsheetBytes,
  fileName: string,
  options?: BookStockFileParseOptions,
): Promise<GloposStockValuationParseResult | null> {
  try {
    return await parseGloposStockValuationReport(buffer, fileName, options);
  } catch {
    return null;
  }
}

/**
 * Parse Stock Valuation (Detail) Excel (MSP / GloPOS).
 * Duplicate Item Codes are summed on Current Stock before import.
 */
export async function parseGloposStockValuationReport(
  buffer: SpreadsheetBytes,
  fileName: string,
  options?: BookStockFileParseOptions,
): Promise<GloposStockValuationParseResult> {
  const report = options?.onProgress;
  report?.({ phase: "workbook", processed: 0, total: 2 });

  await yieldToMain();

  const workbook = readWorkbook(buffer);

  const sheetName = findSheetName(workbook);
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

  const headerRowIndex = findItemCodeHeaderRowIndex(grid);
  if (headerRowIndex < 0) {
    throw new Error(
      "Could not find GloPOS stock valuation header row (Item Code + Current Stock)",
    );
  }

  let bookStockDate: string | null = parseBookStockDateFromFileName(fileName);
  for (let rowIndex = 0; rowIndex < headerRowIndex; rowIndex += 1) {
    const metaValues = (grid[rowIndex] ?? []).map(cellText);
    const fromSheet = parseBookStockDateFromMeta(metaValues);
    if (fromSheet) {
      bookStockDate = fromSheet;
      break;
    }
  }

  const headerRow = grid[headerRowIndex] ?? [];
  const headers = headerRow.map(cellText);
  const colCount = headers.length;

  const itemCodeIndex = findColumnIndex(headers, ["item code"]);
  const itemNameIndex = findColumnIndex(headers, ["item name"]);
  const stockIndex = findColumnIndex(headers, ["current stock"]);

  if (itemCodeIndex < 0 || stockIndex < 0) {
    throw new Error("GloPOS stock valuation file is missing Item Code or Current Stock columns");
  }

  type Agg = { quantity: number; itemName: string };
  const aggregated = new Map<string, Agg>();
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
    const hasAny = rowValues.some((cell) => cellText(cell));
    if (!hasAny) continue;

    const padded: string[] = [];
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      padded[colIndex] = cellText(rowValues[colIndex] ?? "");
    }

    const itemCodeRaw = padded[itemCodeIndex]?.trim() ?? "";
    const itemName =
      itemNameIndex >= 0 ? padded[itemNameIndex]?.trim() ?? "" : itemCodeRaw;

    if (isMetaDataRow(itemCodeRaw, itemName)) continue;

    const productCode = normalizeProductCode(itemCodeRaw);
    if (!productCode) continue;

    const qtyRaw = padded[stockIndex]?.trim() ?? "";
    const qty = parsePlainNumber(qtyRaw);
    if (qty === null) continue;

    sourceRows += 1;
    const existing = aggregated.get(productCode);
    aggregated.set(productCode, {
      quantity: (existing?.quantity ?? 0) + qty,
      itemName: existing?.itemName || itemName,
    });
  }

  const referenceColumn = STOCK_VALUATION_ITEM_CODE_COLUMN;
  const quantityColumn = STOCK_VALUATION_CURRENT_STOCK_COLUMN;

  const rows: ParsedRow[] = [...aggregated.entries()].map(
    ([productCode, { quantity }], index) => ({
      [referenceColumn]: productCode,
      [quantityColumn]: String(quantity),
      __rowNumber: String(index + 2),
    }),
  );

  const duplicateRows = Math.max(0, sourceRows - aggregated.size);

  return {
    headers: [referenceColumn, quantityColumn],
    rows,
    referenceColumn,
    quantityColumn,
    bookStockDate,
    duplicateRows,
    sourceRows,
  };
}
