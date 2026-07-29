import { parse } from "papaparse";
import * as XLSX from "xlsx";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function looksLikeHeaderRow(headers: string[]): boolean {
  const normalized = headers.map(normHeader).filter(Boolean);
  if (normalized.length < 2) return false;

  const has = (patterns: string[]) =>
    patterns.some((pattern) => normalized.includes(normHeader(pattern)));

  if (has(["ID", "Qty"]) || has(["ID", "Quantity"])) return true;
  if (has(["Item Code"]) && normalized.some((h) => h.includes("stock"))) return true;
  if (has(["Item Code"]) && normalized.some((h) => h.includes("sales qty"))) return true;
  if (has(["Barcode"]) && has(["Qty", "QTY", "Quantity"])) return true;
  if (has(["ProductCode", "Product Code"]) && has(["ItemName1", "Item Name"])) return true;
  if (has(["ID", "Id"]) && has(["Name", "Description"])) return true;
  if (has(["Item Code"]) && has(["Name", "Description"])) return true;

  return normalized.length >= 3;
}

function headersFromGridRow(row: unknown[]): string[] {
  return row.map(cellText).filter(Boolean);
}

function readCsvHeaders(buffer: ArrayBuffer): string[] {
  const text = new TextDecoder().decode(buffer.slice(0, 65536));
  const result = parse<Record<string, string>>(text, {
    header: true,
    preview: 1,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  return result.meta.fields ?? [];
}

function readSpreadsheetHeaders(buffer: ArrayBuffer): string[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    sheetRows: 40,
    cellDates: true,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  for (const row of grid) {
    const headers = headersFromGridRow(row ?? []);
    if (looksLikeHeaderRow(headers)) return headers;
  }

  return headersFromGridRow(grid[0] ?? []);
}

/** Read column headers from an upload file in the browser (headers only, fast). */
export async function readUploadFileHeaders(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) return readCsvHeaders(buffer);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return readSpreadsheetHeaders(buffer);
  }
  throw new Error("Unsupported file type. Upload CSV or XLSX.");
}
