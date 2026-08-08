import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { IMPORT_COLUMNS } from "@/lib/import-config";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import { toDecimal } from "@/utils/decimal";

export const STOCK_VARIANCE_BARCODE_COLUMN = "Barcode";
export const STOCK_VARIANCE_QTY_COLUMN = IMPORT_COLUMNS.qty;

export type GloposStockVarianceWastageParseResult = {
  headers: string[];
  rows: ParsedRow[];
  barcodeColumn: string;
  quantityColumn: string;
  wastageDate: string | null;
  duplicateRows: number;
  skippedNonWastageRows: number;
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date (rare when cellDates is on, but keep safe).
    if (value > 20000 && value < 80000 && Number.isInteger(value)) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
    }
    if (Number.isInteger(value)) return String(value);
    return String(value).trim();
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function findHeaderIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => {
    const n = normHeader(header);
    return n && patterns.some((pattern) => pattern.test(n));
  });
}

function isoFromParts(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseFlexibleDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    let yyyy = dmy[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return isoFromParts(dmy[1], dmy[2], yyyy);
  }
  return null;
}

function parseWastageDateFromFileName(fileName: string): string | null {
  // e.g. "sbh waste 03.08.xlsx" or "sbh waste 03.08.2026.xlsx"
  const withYear = fileName.match(/(\d{1,2})[.](\d{1,2})[.](\d{4})/);
  if (withYear) return isoFromParts(withYear[1], withYear[2], withYear[3]);
  const dayMonth = fileName.match(/(?:^|[^\d])(\d{1,2})[.](\d{1,2})(?:[^\d]|$)/);
  if (dayMonth) {
    const year = new Date().getFullYear();
    return isoFromParts(dayMonth[1], dayMonth[2], String(year));
  }
  return null;
}

function mostCommonDate(dates: string[]): string | null {
  if (!dates.length) return null;
  const counts = new Map<string, number>();
  for (const date of dates) {
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [date, count] of counts) {
    if (count > bestCount) {
      best = date;
      bestCount = count;
    }
  }
  return best;
}

/** GloPOS stock count / variance exports: Barcode + QTY Variance (Sudbury-style). */
export function isGloposStockVarianceWastageReport(
  headers: string[],
  fileName = "",
): boolean {
  const joined = headers.map(normHeader).filter(Boolean).join(" | ");
  if (!joined) return false;
  const hasBarcode = /\bbarcode\b/.test(joined);
  const hasVariance =
    /qty\s*variance/.test(joined) || /quantity\s*variance/.test(joined);
  if (hasBarcode && hasVariance) return true;
  // Filename "sbh waste …" / Stock Adjustment Report with barcode column.
  if (
    (/waste/i.test(fileName) || /stock\s*(count|variance|adjust)/i.test(fileName)) &&
    hasBarcode
  ) {
    return hasVariance;
  }
  return false;
}

export async function tryParseGloposStockVarianceWastageReport(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<GloposStockVarianceWastageParseResult | null> {
  try {
    return await parseGloposStockVarianceWastageReport(buffer, fileName);
  } catch {
    return null;
  }
}

/**
 * Parse Sudbury / GloPOS stock variance sheets (e.g. "Stock Adjustment Report").
 * Wastage qty = -(QTY Variance); positive variance (stock gain) is skipped.
 * Duplicate barcodes are summed.
 */
export async function parseGloposStockVarianceWastageReport(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<GloposStockVarianceWastageParseResult> {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellStyles: false,
    cellNF: false,
    sheetStubs: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheets");

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  let headerRowIndex = -1;
  let barcodeCol = -1;
  let varianceCol = -1;
  let nameCol = -1;
  let dateCol = -1;

  for (let r = 0; r < Math.min(grid.length, 40); r += 1) {
    const row = (grid[r] ?? []).map(cellText);
    const barcodeIdx = findHeaderIndex(row, [/^barcode$/]);
    const varianceIdx = findHeaderIndex(row, [
      /^qty\s*variance$/,
      /^quantity\s*variance$/,
    ]);
    if (barcodeIdx >= 0 && varianceIdx >= 0) {
      headerRowIndex = r;
      barcodeCol = barcodeIdx;
      varianceCol = varianceIdx;
      nameCol = findHeaderIndex(row, [/^product\s*name$/, /^description$/]);
      dateCol = findHeaderIndex(row, [/^date$/]);
      break;
    }
  }

  if (headerRowIndex < 0 || barcodeCol < 0 || varianceCol < 0) {
    throw new Error(
      "Could not find stock variance header row (Barcode / QTY Variance)",
    );
  }

  const pending = new Map<string, ParsedRow>();
  let duplicateRows = 0;
  let skippedNonWastageRows = 0;
  const rowDates: string[] = [];

  for (let r = headerRowIndex + 1; r < grid.length; r += 1) {
    const rowValues = (grid[r] ?? []).map(cellText);
    const barcode = formatSpreadsheetBarcode(rowValues[barcodeCol] ?? "").trim();
    if (!barcode) continue;

    const varianceRaw = (rowValues[varianceCol] ?? "").replace(/,/g, "").trim();
    if (!varianceRaw || varianceRaw === "-" || /^update$/i.test(varianceRaw)) {
      continue;
    }

    let wastageQty;
    try {
      // Stock decrease → negative variance → positive wastage after * -1.
      wastageQty = toDecimal(varianceRaw).neg();
      if (!wastageQty.isFinite()) throw new Error("invalid");
    } catch {
      skippedNonWastageRows += 1;
      continue;
    }

    if (wastageQty.lte(0)) {
      skippedNonWastageRows += 1;
      continue;
    }

    if (dateCol >= 0) {
      const fromRow = parseFlexibleDate(rowValues[dateCol] ?? "");
      if (fromRow) rowDates.push(fromRow);
    }

    const existing = pending.get(barcode);
    if (existing) {
      try {
        const sum = toDecimal(existing[STOCK_VARIANCE_QTY_COLUMN] ?? "0").plus(
          wastageQty,
        );
        existing[STOCK_VARIANCE_QTY_COLUMN] = sum.toString();
      } catch {
        existing[STOCK_VARIANCE_QTY_COLUMN] = wastageQty.toString();
      }
      duplicateRows += 1;
      continue;
    }

    const productName =
      nameCol >= 0 ? (rowValues[nameCol] ?? "").trim() : "";
    pending.set(barcode, {
      [STOCK_VARIANCE_BARCODE_COLUMN]: barcode,
      [STOCK_VARIANCE_QTY_COLUMN]: wastageQty.toString(),
      ...(productName ? { __productName: productName } : {}),
      __rowNumber: String(r + 1),
    });
  }

  if (!pending.size) {
    throw new Error(
      "No wastage rows found (need Barcode + negative QTY Variance).",
    );
  }

  const wastageDate =
    mostCommonDate(rowDates) ?? parseWastageDateFromFileName(fileName);

  return {
    headers: [STOCK_VARIANCE_BARCODE_COLUMN, STOCK_VARIANCE_QTY_COLUMN],
    rows: [...pending.values()],
    barcodeColumn: STOCK_VARIANCE_BARCODE_COLUMN,
    quantityColumn: STOCK_VARIANCE_QTY_COLUMN,
    wastageDate,
    duplicateRows,
    skippedNonWastageRows,
  };
}
