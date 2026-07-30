import { parse } from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { normalizeImportBarcode } from "@/utils/barcode";

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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

function findExact(headers: string[], patterns: string[]): string | null {
  return (
    headers.find((header) =>
      patterns.some((pattern) => normHeader(header) === normHeader(pattern)),
    ) ?? null
  );
}

export function detectProductFileColumns(headers: string[]): {
  codeColumn: string | null;
  nameColumn: string | null;
  departmentColumn: string | null;
  barcodeColumn: string | null;
  retailPriceColumn: string | null;
  supplierColumn: string | null;
  supplierCodeColumn: string | null;
  shareAcrossMspStores: boolean;
} {
  const productCodeColumn = findExact(headers, [
    "ProductCode",
    "Product Code",
  ]);
  const idColumn = findExact(headers, ["ID", "Id"]);
  const codeColumn =
    productCodeColumn ??
    idColumn ??
    findExact(headers, ["Item Code", "Code"]) ??
    headers[0] ??
    null;

  return {
    codeColumn,
    nameColumn:
      findExact(headers, [
        "ItemName1",
        "Item Name",
        "Product Name",
        "Name",
        "Description",
      ]) ?? null,
    departmentColumn:
      findExact(headers, [
        "ItemGroupName",
        "Item Group Name",
        "Department",
        "Group",
      ]) ?? null,
    barcodeColumn:
      findExact(headers, ["InnerEan", "EAN", "Barcode", "Inner EAN"]) ?? null,
    retailPriceColumn:
      findExact(headers, ["Selling Price", "Retail Price"]) ??
      findExact(headers, ["Max Retail", "Max\n Retail"]) ??
      findExact(headers, ["Min Retail", "Min\n Retail"]) ??
      null,
    supplierColumn: findExact(headers, ["Supplier"]) ?? null,
    supplierCodeColumn:
      findExact(headers, ["SupplierCode", "Supplier Code"]) ?? null,
    shareAcrossMspStores: Boolean(productCodeColumn),
  };
}

function isProductCatalogHeaderRow(headers: string[]): boolean {
  const normalized = headers.map(normHeader).filter(Boolean);
  if (normalized.length < 2) return false;

  const hasCode = normalized.some(
    (header) =>
      header === "productcode" ||
      header === "product code" ||
      header === "id" ||
      header === "item code" ||
      header === "code",
  );
  const hasName = normalized.some(
    (header) =>
      header === "itemname1" ||
      header === "item name" ||
      header === "product name" ||
      header === "name" ||
      header === "description",
  );

  return hasCode && hasName;
}

function findProductHeaderRowIndex(grid: unknown[][], maxScan = 40): number {
  const lastRow = Math.min(maxScan, grid.length);
  for (let rowIndex = 0; rowIndex < lastRow; rowIndex += 1) {
    const headers = (grid[rowIndex] ?? []).map(cellText);
    if (isProductCatalogHeaderRow(headers)) {
      return rowIndex;
    }
  }
  return 0;
}

function isBarcodeHeader(header: string): boolean {
  const n = normHeader(header);
  return (
    n === "innerean" ||
    n === "inner ean" ||
    n === "ean" ||
    n === "barcode"
  );
}

function parseSpreadsheetBuffer(
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

  const headerRowIndex = findProductHeaderRowIndex(grid);
  const headers = (grid[headerRowIndex] ?? []).map(cellText);
  const barcodeColumnIndexes = new Set<number>();
  headers.forEach((header, index) => {
    if (isBarcodeHeader(header)) barcodeColumnIndexes.add(index);
  });

  const rows: ParsedRow[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const rowValues = grid[rowIndex] ?? [];
    const parsed: ParsedRow = { __rowNumber: String(rowIndex + 1) };
    let hasValue = false;

    for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
      const header = headers[colIndex];
      if (!header) continue;
      const raw = rowValues[colIndex];
      const value = barcodeColumnIndexes.has(colIndex)
        ? normalizeImportBarcode(raw)
        : cellText(raw ?? "");
      parsed[header] = value;
      if (value) hasValue = true;
    }

    if (hasValue) rows.push(parsed);
  }

  return { headers: headers.filter(Boolean), rows };
}

/** Fast synchronous parse — safe for browser and server. */
export function parseProductFileBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): { headers: string[]; rows: ParsedRow[] } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    const result = parse<Record<string, string>>(
      Buffer.isBuffer(buffer) ? buffer.toString("utf-8") : new TextDecoder().decode(buffer),
      {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
      },
    );
    const headers = result.meta.fields ?? [];
    const barcodeHeaders = new Set(
      headers.filter((header) => isBarcodeHeader(header)),
    );
    const rows = (result.data ?? []).map((row, index) => {
      const normalized: ParsedRow = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[key] = barcodeHeaders.has(key)
          ? normalizeImportBarcode(value)
          : String(value ?? "").trim();
      }
      normalized.__rowNumber = String(index + 2);
      return normalized;
    });
    return { headers, rows };
  }

  return parseSpreadsheetBuffer(buffer);
}

export async function parseProductFile(
  buffer: Buffer,
  fileName: string,
): Promise<{ headers: string[]; rows: ParsedRow[] }> {
  return parseProductFileBuffer(buffer, fileName);
}

export function normalizeProductCode(value: string): string {
  let code = value.trim();
  if (!code) return "";
  if (/^\d+\.0+$/.test(code)) {
    code = code.replace(/\.0+$/, "");
  }
  return code;
}

function hasImportBarcode(value: unknown): boolean {
  return normalizeImportBarcode(value).length > 0;
}

export function dedupeProductRows(
  rows: ParsedRow[],
  codeColumn: string,
  barcodeColumn?: string,
): { rows: ParsedRow[]; duplicateRows: number } {
  const seen = new Map<string, ParsedRow>();
  let duplicateRows = 0;

  for (const row of rows) {
    const code = normalizeProductCode(row[codeColumn] ?? "");
    if (!code) continue;

    const existing = seen.get(code);
    if (!existing) {
      seen.set(code, row);
      continue;
    }

    duplicateRows += 1;

    if (barcodeColumn) {
      const existingHas = hasImportBarcode(existing[barcodeColumn]);
      const candidateHas = hasImportBarcode(row[barcodeColumn]);
      if (candidateHas && !existingHas) {
        seen.set(code, row);
      }
    }
  }

  return { rows: [...seen.values()], duplicateRows };
}

/** Every distinct InnerEan/Barcode in the file, grouped by normalized product code. */
export function collectUniqueBarcodesByProductCode(
  rows: ParsedRow[],
  codeColumn: string,
  barcodeColumn?: string,
): Map<string, string[]> {
  const byCode = new Map<string, Set<string>>();
  if (!barcodeColumn) return new Map();

  for (const row of rows) {
    const code = normalizeProductCode(row[codeColumn] ?? "");
    if (!code) continue;
    const barcode = normalizeImportBarcode(row[barcodeColumn]);
    if (!barcode) continue;
    if (!byCode.has(code)) byCode.set(code, new Set());
    byCode.get(code)!.add(barcode);
  }

  const out = new Map<string, string[]>();
  for (const [code, barcodes] of byCode) {
    out.set(code, [...barcodes]);
  }
  return out;
}
