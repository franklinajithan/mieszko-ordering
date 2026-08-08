import ExcelJS from "exceljs";
import type { ParsedRow } from "@/types";
import { IMPORT_COLUMNS } from "@/lib/import-config";
import { normalizeProductCode } from "@/parsers/product-file-parser";
import { formatSpreadsheetBarcode } from "@/utils/barcode";

/** Stable row keys for import (Excel header text varies). */
export const WASTAGE_PRODUCT_CODE_COLUMN = "Product Code";
export const WASTAGE_QTY_COLUMN = IMPORT_COLUMNS.qty;
export const WASTAGE_BARCODE_COLUMN = "Barcode";

export type GloposWastageReportParseResult = {
  headers: string[];
  rows: ParsedRow[];
  productCodeColumn: string;
  quantityColumn: string;
  wastageDate: string | null;
  duplicateRows: number;
  sourceRows: number;
  skippedExcludedReasonRows: number;
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? "").join("").trim();
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text?: string }).text ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (typeof value === "object" && "result" in value) {
    return cellText(value.result as ExcelJS.CellValue);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isoFromDmy(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseWastageDateFromMeta(values: string[]): string | null {
  for (const value of values) {
    if (!value) continue;
    const range = value.match(
      /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*[-–—]\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/,
    );
    if (range) {
      const [, , , , dd2, mm2, yyyy2] = range;
      return isoFromDmy(dd2, mm2, yyyy2);
    }
    const single = value.match(/date\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i);
    if (single) {
      const [, dd, mm, yyyy] = single;
      return isoFromDmy(dd, mm, yyyy);
    }
    const filenameStyle = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (filenameStyle && /wastage|enquiry|report/i.test(value)) {
      const [, dd, mm, yyyy] = filenameStyle;
      return isoFromDmy(dd, mm, yyyy);
    }
  }
  return null;
}

function parseWastageDateFromFileName(fileName: string): string | null {
  const match = fileName.match(/_(\d{4})(\d{2})(\d{2})_/);
  if (match) {
    const [, yyyy, mm, dd] = match;
    return isoFromDmy(dd, mm, yyyy);
  }
  return null;
}

/** Reasons whose line items must not be imported as wastage (mirrors Weekly_Waste_updated.py + credit note). */
const EXCLUDED_WASTAGE_REASONS = new Set(
  [
    "Stock Correction (+)",
    "Stock Correction (-)",
    "Store Use",
    "Store Transfers (Out)",
    "Store Transfers (In)",
    "Transfers",
    "Stock take corrections +",
    "Stock take corrections -",
    "Consider as Credit Note",
  ].map((s) => s.trim().toLowerCase()),
);

function isExcludedReasonDescription(description: string): boolean {
  const norm = description.trim().toLowerCase();
  if (!norm) return false;
  if (EXCLUDED_WASTAGE_REASONS.has(norm)) return true;
  if (norm.includes("consider as credit note")) return true;
  if (/transfer\s*(in|out)/i.test(norm)) return true;
  if (/tanfer\s*(in|out)/i.test(norm)) return true;
  if (norm.includes("store transfer")) return true;
  return false;
}

function extractReasonDescription(firstCol: string): string | null {
  const match = firstCol.match(/reason\s*description\s*:\s*(.+)/i);
  return match?.[1]?.trim() ?? null;
}

function extractSubtotalReason(firstCol: string): string | null {
  const match = firstCol.match(/^total\s*for\s*(.+?)\s*:/i);
  return match?.[1]?.trim() ?? null;
}

function findWastageSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  const byName = workbook.worksheets.find((sheet) =>
    /wastagereport/i.test(sheet.name.replace(/\s+/g, "")),
  );
  return byName ?? workbook.worksheets[0] ?? null;
}

function findProductCodeHeaderRow(sheet: ExcelJS.Worksheet, maxScan = 80): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(maxScan, sheet.rowCount); rowNumber += 1) {
    const values: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      values[colNumber - 1] = normHeader(cellText(cell.value));
    });
    if (values.some((v) => v === "product code")) {
      return rowNumber;
    }
  }
  return null;
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

function readRowValues(sheet: ExcelJS.Worksheet, rowNumber: number, colCount: number): string[] {
  const rowValues: string[] = new Array(colCount).fill("");
  sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber - 1 < colCount) {
      rowValues[colNumber - 1] = cellText(cell.value);
    }
  });
  return rowValues;
}

export function isGloposWastageReport(headers: string[], fileName: string): boolean {
  if (/wastage/i.test(fileName)) return true;
  const text = headers.map(normHeader).join(" | ");
  return text.includes("product code") && (text.includes("qty") || text.includes("quantity"));
}

export async function tryParseGloposWastageReport(
  buffer: Buffer,
  fileName: string,
): Promise<GloposWastageReportParseResult | null> {
  try {
    return await parseGloposWastageReport(buffer, fileName);
  } catch {
    return null;
  }
}

export async function parseGloposWastageReport(
  buffer: Buffer,
  fileName: string,
): Promise<GloposWastageReportParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = findWastageSheet(workbook);
  if (!sheet) throw new Error("Workbook has no worksheets");

  const headerRowNumber = findProductCodeHeaderRow(sheet);
  if (headerRowNumber === null) {
    throw new Error("Could not find GloPOS wastage header row (Product Code)");
  }

  let wastageDate: string | null = parseWastageDateFromFileName(fileName);
  for (let rowNumber = 1; rowNumber < headerRowNumber; rowNumber += 1) {
    const metaValues: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      metaValues[colNumber - 1] = cellText(cell.value);
    });
    const fromSheet = parseWastageDateFromMeta(metaValues);
    if (fromSheet) {
      wastageDate = fromSheet;
      break;
    }
  }

  const headers: string[] = [];
  sheet.getRow(headerRowNumber).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });
  const colCount = headers.length;

  const productCodeIndex = findColumnIndex(headers, ["product code"]);
  const qtyIndex = findColumnIndex(headers, ["qty", "quantity"]);
  const descriptionIndex = findColumnIndex(headers, ["description"]);
  const barcodeIndex = findColumnIndex(headers, ["barcode"]);

  if (productCodeIndex < 0 || qtyIndex < 0) {
    throw new Error("GloPOS wastage file is missing Product Code or Qty columns");
  }

  const firstColIndex = productCodeIndex;
  let currentReason = "";
  let skippedExcludedReasonRows = 0;

  type Agg = { qty: number; productName: string; barcode: string };
  const aggregated = new Map<string, Agg>();
  let sourceRows = 0;

  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const rowValues = readRowValues(sheet, rowNumber, colCount);
    const hasAny = rowValues.some((v) => v.trim());
    if (!hasAny) continue;

    const firstCol = rowValues[firstColIndex]?.trim() ?? "";
    const firstLower = firstCol.toLowerCase();
    const isMarker =
      firstLower.startsWith("reason") || /reason\s*code/i.test(firstCol);
    const isSubtotal = firstLower.startsWith("total for");

    if (isMarker) {
      const desc = extractReasonDescription(firstCol);
      if (desc) currentReason = desc;
      continue;
    }

    if (isSubtotal) {
      const subReason = extractSubtotalReason(firstCol) ?? "";
      if (isExcludedReasonDescription(subReason) || isExcludedReasonDescription(currentReason)) {
        continue;
      }
      continue;
    }

    if (isExcludedReasonDescription(currentReason)) {
      skippedExcludedReasonRows += 1;
      continue;
    }

    const productCodeRaw = rowValues[productCodeIndex]?.trim() ?? "";
    const productCode = normalizeProductCode(productCodeRaw);
    if (!productCode) continue;

    const description =
      descriptionIndex >= 0 ? rowValues[descriptionIndex]?.trim() ?? "" : "";
    if (!description || description.toLowerCase() === "nan") continue;

    const qtyRaw = rowValues[qtyIndex]?.trim() ?? "";
    const qty = parsePlainNumber(qtyRaw);
    if (qty === null || qty <= 0) continue;

    let barcode = "";
    if (barcodeIndex >= 0) {
      const barcodeCell = sheet.getRow(rowNumber).getCell(barcodeIndex + 1);
      const barcodeRaw =
        barcodeCell.text?.replace(/\s+/g, " ").trim() || cellText(barcodeCell.value);
      barcode = formatSpreadsheetBarcode(barcodeRaw).trim();
    }

    sourceRows += 1;
    const existing = aggregated.get(productCode);
    aggregated.set(productCode, {
      qty: (existing?.qty ?? 0) + qty,
      productName: existing?.productName || description,
      barcode: existing?.barcode || barcode,
    });
  }

  const productCodeColumn = WASTAGE_PRODUCT_CODE_COLUMN;
  const quantityColumn = WASTAGE_QTY_COLUMN;

  const outputHeaders = [productCodeColumn, quantityColumn];
  if (barcodeIndex >= 0) outputHeaders.push(WASTAGE_BARCODE_COLUMN);

  const rows: ParsedRow[] = [...aggregated.entries()].map(
    ([productCode, { qty, productName, barcode }], index) => {
      const row: ParsedRow = {
        [productCodeColumn]: productCode,
        [quantityColumn]: String(qty),
        __productName: productName,
        __rowNumber: String(index + 2),
      };
      if (barcode) {
        row[WASTAGE_BARCODE_COLUMN] = barcode;
      }
      return row;
    },
  );

  const duplicateRows = Math.max(0, sourceRows - aggregated.size);

  return {
    headers: outputHeaders,
    rows,
    productCodeColumn,
    quantityColumn,
    wastageDate,
    duplicateRows,
    sourceRows,
    skippedExcludedReasonRows,
  };
}
