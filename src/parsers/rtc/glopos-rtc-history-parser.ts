import ExcelJS from "exceljs";
import type { ParsedRow } from "@/types";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import { Decimal } from "@/utils/decimal";
import { isIsoDateString } from "@/utils/iso-date";

export type GloposRtcHistoryParseResult = {
  headers: string[];
  rows: ParsedRow[];
  barcodeColumn: string;
  quantityColumn: string;
  rtcDate: string | null;
  duplicateRows: number;
  sourceRows: number;
};

class RtcHistoryDateError extends Error {}

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
  const day = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  if (!isIsoDateString(day)) throw new RtcHistoryDateError("RTC report contains an invalid date");
  return day;
}

function parseRtcDateFromRow(values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;
    const range = value.match(/date\s*range\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+to\s+(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i);
    if (range) {
      const start = isoFromDmy(range[1], range[2], range[3]);
      const end = isoFromDmy(range[4], range[5], range[6]);
      if (start !== end) throw new RtcHistoryDateError("RTC history must cover one calendar date");
      return start;
    }
    const enquiryDate = value.match(/date\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i);
    if (enquiryDate) {
      const [, dd, mm, yyyy] = enquiryDate;
      return isoFromDmy(dd, mm, yyyy);
    }
  }
  return null;
}

function findHeaderRow(sheet: ExcelJS.Worksheet, maxScan = 40): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(maxScan, sheet.rowCount); rowNumber++) {
    const values: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      values[colNumber - 1] = normHeader(cellText(cell.value));
    });
    const text = values.filter(Boolean).join(" | ");
    if (
      (text.includes("barcode") || text.includes("ean")) &&
      text.includes("qty")
    ) {
      return rowNumber;
    }
  }
  return null;
}

function findColumnIndex(headers: string[], patterns: string[]): number {
  for (let index = 0; index < headers.length; index += 1) {
    const header = normHeader(headers[index] ?? "");
    if (!header) continue;
    if (
      patterns.some(
        (pattern) =>
          header === pattern ||
          header.startsWith(pattern) ||
          header.includes(pattern),
      )
    ) {
      return index;
    }
  }
  return -1;
}

function parsePlainNumber(value: string): Decimal | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = new Decimal(trimmed);
  return parsed.isFinite() ? parsed : null;
}

function isMetaRow(barcode: string, description: string): boolean {
  const lowerBarcode = barcode.toLowerCase();
  const lowerDesc = description.toLowerCase();
  return (
    !barcode ||
    lowerBarcode.startsWith("item group name") ||
    lowerDesc.startsWith("item group name") ||
    lowerBarcode.startsWith("total :") ||
    lowerDesc.startsWith("total :") ||
    lowerBarcode.startsWith("grand total") ||
    lowerDesc.startsWith("grand total") ||
    lowerDesc.includes("trans id - till name") ||
    normHeader(barcode).includes("barcode")
  );
}

export function isGloposRtcHistoryReport(headers: string[], fileName: string): boolean {
  if (/rtc\s*sales\s*history/i.test(fileName)) return true;
  if (/price\s*override\s*&\s*rtc/i.test(fileName)) return true;
  const text = headers.map(normHeader).join(" | ");
  return (
    (text.includes("barcode") || text.includes("ean")) &&
    text.includes("qty")
  );
}

export async function tryParseGloposRtcHistoryReport(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
): Promise<GloposRtcHistoryParseResult | null> {
  try {
    return await parseGloposRtcHistoryReport(buffer, fileName);
  } catch (error) {
    if (error instanceof RtcHistoryDateError) throw error;
    return null;
  }
}

export async function parseGloposRtcHistoryReport(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
): Promise<GloposRtcHistoryParseResult> {
  void fileName;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook has no worksheets");

  const headerRowNumber = findHeaderRow(sheet);
  if (headerRowNumber === null) {
    throw new Error("Could not find GloPOS RTC header row (Barcode / Qty)");
  }

  let rtcDate: string | null = null;
  for (let rowNumber = 1; rowNumber < headerRowNumber; rowNumber += 1) {
    const metaValues: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      metaValues[colNumber - 1] = cellText(cell.value);
    });
    const fromSheet = parseRtcDateFromRow(metaValues);
    if (fromSheet) {
      rtcDate = fromSheet;
      break;
    }
  }

  const headers: string[] = [];
  sheet.getRow(headerRowNumber).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });

  const barcodeIndex = findColumnIndex(headers, ["barcode", "ean"]);
  const qtyIndex = findColumnIndex(headers, ["qty"]);
  const descriptionIndex = findColumnIndex(headers, ["sale description", "description"]);
  const reasonIndex = findColumnIndex(headers, ["reason"]);
  const scannedDateIndex = findColumnIndex(headers, ["scanned date"]);

  if (barcodeIndex < 0 || qtyIndex < 0) {
    throw new Error("GloPOS RTC file is missing Barcode/EAN or Qty columns");
  }

  const aggregated = new Map<string, { qty: Decimal; productName: string }>();
  let sourceRows = 0;

  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= sheet.rowCount;
    rowNumber += 1
  ) {
    const rowValues: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      rowValues[colNumber - 1] = cellText(cell.value);
    });

    const barcodeCell = sheet.getRow(rowNumber).getCell(barcodeIndex + 1);
    const barcodeRaw =
      barcodeCell.text?.replace(/\s+/g, " ").trim() ||
      cellText(barcodeCell.value);
    const barcode = formatSpreadsheetBarcode(barcodeRaw).trim();
    const description =
      descriptionIndex >= 0 ? rowValues[descriptionIndex]?.trim() ?? "" : barcode;
    const qtyRaw = rowValues[qtyIndex]?.trim() ?? "";

    if (isMetaRow(barcode, description)) continue;

    // This history includes ordinary price overrides as well as RTC sales.
    if (reasonIndex >= 0 && !/^(?:reduce\s+to\s+clear|rtc)$/i.test(rowValues[reasonIndex]?.trim() ?? "")) continue;

    const qty = parsePlainNumber(qtyRaw);
    if (qty === null || qty.lte(0)) continue;

    if (scannedDateIndex >= 0) {
      const scanned = rowValues[scannedDateIndex]?.trim() ?? "";
      const dmy = scanned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s|$)/);
      const iso = scanned.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/);
      const day = dmy ? isoFromDmy(dmy[1], dmy[2], dmy[3]) : iso?.[1];
      if (!day || !isIsoDateString(day)) throw new RtcHistoryDateError("RTC transaction has a missing or invalid scanned date");
      if (rtcDate && rtcDate !== day) throw new RtcHistoryDateError("RTC transaction date differs from the report date");
      rtcDate = day;
    }

    sourceRows += 1;
    const existing = aggregated.get(barcode);
    aggregated.set(barcode, {
      qty: (existing?.qty ?? new Decimal(0)).plus(qty),
      productName: existing?.productName || description,
    });
  }

  const barcodeColumn = headers[barcodeIndex]!.trim();
  const quantityColumn = headers[qtyIndex]!.trim();
  const rows: ParsedRow[] = [...aggregated.entries()].map(
    ([barcode, { qty, productName }], index) => ({
      [barcodeColumn]: barcode,
      [quantityColumn]: String(qty),
      __productName: productName,
      __rowNumber: String(index + 2),
    }),
  );

  const duplicateRows = Math.max(0, sourceRows - aggregated.size);

  return {
    headers: [barcodeColumn, quantityColumn],
    rows,
    barcodeColumn,
    quantityColumn,
    rtcDate,
    duplicateRows,
    sourceRows,
  };
}
