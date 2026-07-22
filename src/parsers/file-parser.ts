import { parse } from "papaparse";
import ExcelJS from "exceljs";
import type { FilePreview, ParsedRow } from "@/types";

function normalizeCell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) {
    return normalizeCell(value.result as ExcelJS.CellValue);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export async function parseUploadedFile(
  buffer: Buffer,
  fileName: string,
  maxPreviewRows = 10,
): Promise<FilePreview> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseCsv(buffer.toString("utf-8"), maxPreviewRows);
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseXlsx(buffer, maxPreviewRows);
  }
  throw new Error("Unsupported file type. Upload CSV or XLSX.");
}

function parseCsv(content: string, maxPreviewRows: number): FilePreview {
  const result = parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const rows = (result.data ?? []).slice(0, maxPreviewRows).map((row) => {
    const normalized: ParsedRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = String(value ?? "").trim();
    }
    return normalized;
  });

  return { headers, rows };
}

async function parseXlsx(
  buffer: Buffer,
  maxPreviewRows: number,
): Promise<FilePreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error("Workbook has no worksheets");
  }

  const headers: string[] = [];
  const rows: ParsedRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = normalizeCell(cell.value);
      });
      return;
    }

    if (rowNumber <= maxPreviewRows + 1) {
      const parsed: ParsedRow = {};
      headers.forEach((header, index) => {
        const cell = row.getCell(index + 1);
        parsed[header] = normalizeCell(cell.value);
      });
      rows.push(parsed);
    }
  });

  return { headers: headers.filter(Boolean), rows };
}

export async function parseAllRows(
  buffer: Buffer,
  fileName: string,
): Promise<{ headers: string[]; rows: ParsedRow[] }> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    const result = parse<Record<string, string>>(buffer.toString("utf-8"), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    const headers = result.meta.fields ?? [];
    const rows = (result.data ?? []).map((row, index) => {
      const normalized: ParsedRow = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[key] = String(value ?? "").trim();
      }
      normalized.__rowNumber = String(index + 2);
      return normalized;
    });
    return { headers, rows };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook has no worksheets");

  const headers: string[] = [];
  const rows: ParsedRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = normalizeCell(cell.value);
      });
      return;
    }

    const parsed: ParsedRow = { __rowNumber: String(rowNumber) };
    headers.forEach((header, index) => {
      parsed[header] = normalizeCell(row.getCell(index + 1).value);
    });
    rows.push(parsed);
  });

  return { headers: headers.filter(Boolean), rows };
}

export function detectKnownColumns(
  supplierCode: string,
  headers: string[],
): { referenceColumn: string | null; priceColumn: string | null } {
  const known = {
    MM: { reference: ["Index"], price: ["Net Price (Invoice)"] },
    SP: { reference: ["Index"], price: ["NetPrice"] },
    WAB: { reference: ["Index", "Code"], price: ["NetPrice", "Price"] },
  }[supplierCode.toUpperCase()];

  if (!known) return { referenceColumn: null, priceColumn: null };

  const findMatch = (candidates: string[]) =>
    headers.find((h) =>
      candidates.some((c) => c.toLowerCase() === h.toLowerCase()),
    ) ?? null;

  return {
    referenceColumn: findMatch(known.reference),
    priceColumn: findMatch(known.price),
  };
}

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
    productColumn: find(["product", "code", "sku", "item"]),
    dateColumn: find(["date", "sales date"]),
    quantityColumn: find(["qty", "quantity", "sold"]),
  };
}
