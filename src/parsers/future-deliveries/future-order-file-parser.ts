import { parse } from "papaparse";
import * as XLSX from "xlsx";
import { normalizeUtf8SupplierCode } from "@/parsers/supplier-codes/supplier-code-file-parser";

const CODE_HEADERS = ["index", "indeks", "code"];
const QTY_HEADERS = [
  "ordered number",
  "ordered qty",
  "ordered quantity",
  "ilosc",
  "ilość",
  "qty",
  "quantity",
];

function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

export function parseOrderQty(raw: string): number {
  const trimmed = raw.trim().replace(/\s/g, "");
  if (!trimmed) return Number.NaN;
  const normalized =
    trimmed.includes(",") && !trimmed.includes(".")
      ? trimmed.replace(",", ".")
      : trimmed.replace(/,/g, "");
  return Number(normalized);
}

function isHeaderRow(cells: string[]): boolean {
  const values = cells.map(norm);
  const hasCode = values.some((value) => CODE_HEADERS.includes(value));
  const hasQty = values.some((value) => QTY_HEADERS.includes(value));
  return hasCode && hasQty;
}

function readGrid(buffer: Buffer, fileName: string): string[][] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    const parsed = parse<string[]>(buffer.toString("utf-8"), {
      skipEmptyLines: true,
    });
    return (parsed.data ?? []).map((row) => row.map(cellText));
  }
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    sheetStubs: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheets");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  });
  return grid.map((row) => (row ?? []).map(cellText));
}

export function detectFutureOrderColumns(headers: string[]): {
  codeColumn: string | null;
  quantityColumn: string | null;
} {
  return {
    codeColumn: headers.find((header) => CODE_HEADERS.includes(norm(header))) ?? null,
    quantityColumn:
      headers.find((header) => QTY_HEADERS.includes(norm(header))) ?? null,
  };
}

export function parseFutureOrderGrid(grid: string[][]): Array<{
  supplierCode: string;
  quantity: string;
  rowNumber: number;
}> {
  const totals = new Map<string, { quantity: number; rowNumber: number }>();
  let codeIndex = -1;
  let qtyIndex = -1;

  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const cells = grid[rowIndex] ?? [];
    if (isHeaderRow(cells)) {
      const headers = cells.map((cell) => cell.trim());
      codeIndex = headers.findIndex((header) => CODE_HEADERS.includes(norm(header)));
      qtyIndex = headers.findIndex((header) => QTY_HEADERS.includes(norm(header)));
      continue;
    }
    if (codeIndex < 0 || qtyIndex < 0) continue;

    const supplierCode = normalizeUtf8SupplierCode(cells[codeIndex] ?? "");
    if (!supplierCode || CODE_HEADERS.includes(norm(supplierCode))) continue;
    const quantity = parseOrderQty(cells[qtyIndex] ?? "");
    if (!Number.isFinite(quantity) || quantity === 0) continue;

    const current = totals.get(supplierCode);
    if (current) {
      current.quantity += quantity;
    } else {
      totals.set(supplierCode, { quantity, rowNumber: rowIndex + 1 });
    }
  }

  return [...totals.entries()].map(([supplierCode, value]) => ({
    supplierCode,
    quantity: String(value.quantity),
    rowNumber: value.rowNumber,
  }));
}

function parseSupplierQtyFileBuffer(
  buffer: Buffer,
  fileName: string,
  missingColumnsMessage: string,
  emptyRowsMessage: string,
) {
  const grid = readGrid(buffer, fileName);
  const firstHeader = grid.find((row) => isHeaderRow(row));
  if (!firstHeader) {
    throw new Error(missingColumnsMessage);
  }
  const columns = detectFutureOrderColumns(firstHeader);
  const rows = parseFutureOrderGrid(grid);
  if (!rows.length) {
    throw new Error(emptyRowsMessage);
  }
  return {
    headers: firstHeader,
    codeColumn: columns.codeColumn,
    quantityColumn: columns.quantityColumn,
    rows,
  };
}

export function parseFutureOrderFileBuffer(buffer: Buffer, fileName: string) {
  return parseSupplierQtyFileBuffer(
    buffer,
    fileName,
    "Could not find Index and Ordered number columns in this order file.",
    "No Index / Ordered number rows found in this order file.",
  );
}

export function parseFutureInvoiceFileBuffer(buffer: Buffer, fileName: string) {
  return parseSupplierQtyFileBuffer(
    buffer,
    fileName,
    "Could not find INDEKS and ILOSC columns in this invoice file.",
    "No INDEKS / ILOSC rows found in this invoice file.",
  );
}
