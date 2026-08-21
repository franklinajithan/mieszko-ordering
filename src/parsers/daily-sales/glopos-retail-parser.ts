import ExcelJS from "exceljs";
import type { ParsedRow } from "@/types";

export type GloposRetailParseResult = {
  headers: string[];
  rows: ParsedRow[];
  itemCodeColumn: string;
  salesQtyColumn: string;
  salesDate: string | null;
  periodLabel: string | null;
  duplicateRows: number;
  sourceRows: number;
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

function parseSalesDateFromRow(values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (!value) continue;
    const daySlash = value.match(
      /(?:day\s*:|stock\s*report\s*:\s*from\s*:?)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
    );
    if (daySlash) {
      const [, dd, mm, yyyy] = daySlash;
      return isoFromDmy(dd, mm, yyyy);
    }
    // Product Sales Enquiry header, e.g. "Date : 26-07-2026"
    const enquiryDate = value.match(/date\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i);
    if (enquiryDate) {
      const [, dd, mm, yyyy] = enquiryDate;
      return isoFromDmy(dd, mm, yyyy);
    }
    const dateRange = value.match(
      /date\s*range\s*:\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+to\s+(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i,
    );
    if (dateRange) {
      const [, startDay, startMonth, startYear, endDay, endMonth, endYear] =
        dateRange;
      if (
        startDay === endDay &&
        startMonth === endMonth &&
        startYear === endYear
      ) {
        return isoFromDmy(startDay, startMonth, startYear);
      }
    }
  }
  return null;
}

function parseDateFromFilename(fileName: string): string | null {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, "");
  const daily = base.match(/^(\d{2})\.(\d{2})$/);
  if (daily) {
    const year = new Date().getFullYear();
    return `${year}-${daily[2]}-${daily[1]}`;
  }
  // Export timestamp in filename (report run time, not sales date)
  if (/_20\d{6}_\d{6}(?:\.|$)/i.test(base)) {
    return null;
  }
  const stamped = base.match(/(?:^|[_\s-])(20\d{2})(\d{2})(\d{2})(?:[_\s.-]|$)/);
  if (stamped) {
    return `${stamped[1]}-${stamped[2]}-${stamped[3]}`;
  }
  return null;
}

function parsePeriodLabelFromFilename(fileName: string): string | null {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, "");
  const range = base.match(
    /^(\d{2})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/,
  );
  if (!range) return null;
  const [, d1, m1, y1, d2, m2, y2] = range;
  return `${d1}.${m1}.${y1} - ${d2}.${m2}.${y2}`;
}

function parsePeriodEndDate(fileName: string): string | null {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, "");
  const range = base.match(
    /^(\d{2})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/,
  );
  if (!range) return null;
  const [, , , , d2, m2, y2] = range;
  return `20${y2}-${m2}-${d2}`;
}

function isGroupOrMetaRow(description: string): boolean {
  const lower = description.toLowerCase();
  return (
    !description ||
    lower.startsWith("item group name") ||
    lower.startsWith("day :") ||
    lower.startsWith("group by type")
  );
}

function findHeaderRow(sheet: ExcelJS.Worksheet, maxScan = 40): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(maxScan, sheet.rowCount); rowNumber++) {
    const values: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      values[colNumber - 1] = normHeader(cellText(cell.value));
    });
    const text = values.filter(Boolean).join(" | ");
    const isProductSalesEnquiry =
      text.includes("item code") && text.includes("description");
    const isStockReport = text.includes("id") && text.includes("sold qty");
    if (isProductSalesEnquiry || isStockReport) {
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

function parsePlainNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isGloposRetailReport(headers: string[], fileName: string): boolean {
  if (/product\s*sales\s*enquiry/i.test(fileName)) return true;
  if (parsePeriodLabelFromFilename(fileName)) return true;
  if (parseDateFromFilename(fileName)) return true;
  const text = headers.map(normHeader).join(" | ");
  return (
    (text.includes("item code") && text.includes("sales qty")) ||
    (text.includes("id") && text.includes("sold qty"))
  );
}

export async function tryParseRetailSalesReport(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
): Promise<GloposRetailParseResult | null> {
  try {
    return await parseGloposRetailReport(buffer, fileName);
  } catch {
    return null;
  }
}

export function isLikelyRetailSalesFileName(fileName: string): boolean {
  if (/product\s*sales\s*enquiry/i.test(fileName)) return true;
  return Boolean(parseDateFromFilename(fileName) || parsePeriodLabelFromFilename(fileName));
}

export async function parseGloposRetailReport(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
): Promise<GloposRetailParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook has no worksheets");

  const headerRowNumber = findHeaderRow(sheet);
  if (headerRowNumber === null) {
    throw new Error("Could not find GloPOS header row (Item Code / Description)");
  }

  const headers: string[] = [];
  sheet.getRow(headerRowNumber).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value);
  });

  // GloPOS Product Sales Enquiry reports use Item Code. GloPOS Stock Reports
  // use the numeric ID. PLU must never be used as a product reference.
  const itemCodeColumnIndex = findColumnIndex(headers, ["item code"]);
  const itemCodeIndex =
    itemCodeColumnIndex >= 0
      ? itemCodeColumnIndex
      : findColumnIndex(headers, ["id"]);
  const salesQtyIndex = findColumnIndex(headers, ["sales qty", "sold qty"]);
  const descriptionIndex = findColumnIndex(headers, ["description", "product name"]);

  if (itemCodeIndex < 0 || salesQtyIndex < 0) {
    throw new Error("GloPOS file is missing ID/Item Code or Sales Qty/Sold QTY columns");
  }

  let salesDate: string | null = null;
  for (let rowNumber = 1; rowNumber <= headerRowNumber; rowNumber += 1) {
    const metaValues: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      metaValues[colNumber - 1] = cellText(cell.value);
    });
    const fromSheet = parseSalesDateFromRow(metaValues);
    if (fromSheet) {
      salesDate = fromSheet;
      break;
    }
  }
  if (!salesDate) {
    salesDate =
      parsePeriodEndDate(fileName) ??
      parseDateFromFilename(fileName);
  }

  const aggregated = new Map<string, { qty: number; productName: string }>();
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

    const itemCode = rowValues[itemCodeIndex]?.trim() ?? "";
    const description =
      descriptionIndex >= 0 ? rowValues[descriptionIndex]?.trim() ?? "" : itemCode;
    const qtyRaw = rowValues[salesQtyIndex]?.trim() ?? "";

    if (!itemCode || isGroupOrMetaRow(description)) continue;

    const qty = parsePlainNumber(qtyRaw);
    if (qty === null) continue;

    sourceRows += 1;
    const existing = aggregated.get(itemCode);
    aggregated.set(itemCode, {
      qty: (existing?.qty ?? 0) + qty,
      productName: existing?.productName || description,
    });
  }

  const itemCodeColumn = headers[itemCodeIndex]!.trim();
  const salesQtyColumn = headers[salesQtyIndex]!.trim();
  const rows: ParsedRow[] = [...aggregated.entries()].map(
    ([itemCode, { qty, productName }], index) => ({
      [itemCodeColumn]: itemCode,
      [salesQtyColumn]: String(qty),
      __productName: productName,
      __rowNumber: String(index + 2),
    }),
  );

  const duplicateRows = Math.max(0, sourceRows - aggregated.size);

  return {
    headers: [itemCodeColumn, salesQtyColumn],
    rows,
    itemCodeColumn,
    salesQtyColumn,
    salesDate,
    periodLabel: parsePeriodLabelFromFilename(fileName),
    duplicateRows,
    sourceRows,
  };
}
