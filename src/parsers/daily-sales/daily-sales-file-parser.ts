import { parse } from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { tryParseRetailSalesReport } from "@/parsers/daily-sales/glopos-retail-parser";

export function detectSalesColumns(headers: string[]): {
  productColumn: string | null;
  dateColumn: string | null;
  quantityColumn: string | null;
} {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (patterns: string[]) => {
    const idx = lower.findIndex((h) =>
      patterns.some((p) => h.includes(p)),
    );
    return idx >= 0 ? headers[idx] : null;
  };

  return {
    productColumn: find(["product", "code", "sku", "item", "id"]),
    dateColumn: find(["date", "sales date"]),
    quantityColumn: find(["qty", "quantity", "sold"]),
  };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value).trim();
  }
  return String(value).trim();
}

function decodeText(buffer: ArrayBuffer | Buffer): string {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(buffer)) {
    return buffer.toString("utf-8");
  }
  return new TextDecoder().decode(buffer as ArrayBuffer);
}

function parseFlatSpreadsheet(
  buffer: ArrayBuffer | Buffer,
): { headers: string[]; rows: ParsedRow[] } {
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

  const headers = (grid[0] ?? []).map(cellText);
  const rows: ParsedRow[] = [];
  for (let rowIndex = 1; rowIndex < grid.length; rowIndex += 1) {
    const rowValues = grid[rowIndex] ?? [];
    const parsed: ParsedRow = { __rowNumber: String(rowIndex + 1) };
    let hasValue = false;
    for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
      const header = headers[colIndex];
      if (!header) continue;
      const value = cellText(rowValues[colIndex] ?? "");
      parsed[header] = value;
      if (value) hasValue = true;
    }
    if (hasValue) rows.push(parsed);
  }

  return { headers: headers.filter(Boolean), rows };
}

function parseFlatCsv(buffer: ArrayBuffer | Buffer): {
  headers: string[];
  rows: ParsedRow[];
} {
  const result = parse<Record<string, string>>(decodeText(buffer), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  const headers = result.meta.fields ?? [];
  const rows = (result.data ?? []).map((row, index) => {
    const normalized: ParsedRow = { __rowNumber: String(index + 2) };
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = String(value ?? "").trim();
    }
    return normalized;
  });
  return { headers, rows };
}

export type DailySalesFileParseResult = {
  headers: string[];
  rows: ParsedRow[];
  productColumn?: string;
  quantityColumn?: string;
  manualSalesDate?: string;
  periodLabel?: string | null;
  duplicateRows?: number;
};

/** Parse a daily-sales CSV/XLSX — safe for browser and server. */
export async function parseDailySalesFileBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<DailySalesFileParseResult> {
  const retail = await tryParseRetailSalesReport(buffer, fileName);
  if (retail) {
    return {
      headers: retail.headers,
      rows: retail.rows,
      productColumn: retail.itemCodeColumn,
      quantityColumn: retail.salesQtyColumn,
      manualSalesDate: retail.salesDate ?? undefined,
      periodLabel: retail.periodLabel,
      duplicateRows: retail.duplicateRows,
    };
  }

  const lower = fileName.toLowerCase();
  const flat = lower.endsWith(".csv")
    ? parseFlatCsv(buffer)
    : parseFlatSpreadsheet(buffer);
  const detected = detectSalesColumns(flat.headers);
  return {
    ...flat,
    productColumn: detected.productColumn ?? undefined,
    quantityColumn: detected.quantityColumn ?? undefined,
  };
}
