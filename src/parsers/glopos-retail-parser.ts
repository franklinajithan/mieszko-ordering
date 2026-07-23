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

function parseSalesDateFromRow(values: string[]): string | null {
  for (const value of values) {
    const match = value.match(/day\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    if (match) {
      const [, dd, mm, yyyy] = match;
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
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
    if (text.includes("item code") && text.includes("description")) {
      return rowNumber;
    }
  }
  return null;
}

function findColumnIndex(headers: string[], patterns: string[]): number {
  for (let index = 0; index < headers.length; index += 1) {
    const header = normHeader(headers[index] ?? "");
    if (patterns.some((pattern) => header.startsWith(pattern))) {
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
  if (parsePeriodLabelFromFilename(fileName)) return true;
  if (parseDateFromFilename(fileName)) return true;
  const text = headers.map(normHeader).join(" | ");
  return text.includes("item code") && text.includes("sales qty");
}

export async function tryParseRetailSalesReport(
  buffer: Buffer,
  fileName: string,
): Promise<GloposRetailParseResult | null> {
  try {
    return await parseGloposRetailReport(buffer, fileName);
  } catch {
    return null;
  }
}

export function isLikelyRetailSalesFileName(fileName: string): boolean {
  return Boolean(parseDateFromFilename(fileName) || parsePeriodLabelFromFilename(fileName));
}

export async function parseGloposRetailReport(
  buffer: Buffer,
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

  const itemCodeIndex = findColumnIndex(headers, ["item code"]);
  const salesQtyIndex = findColumnIndex(headers, ["sales qty"]);
  const descriptionIndex = findColumnIndex(headers, ["description"]);

  if (itemCodeIndex < 0 || salesQtyIndex < 0) {
    throw new Error("GloPOS file is missing Item Code or Sales Qty columns");
  }

  let salesDate =
    parsePeriodEndDate(fileName) ??
    parseDateFromFilename(fileName);

  for (let rowNumber = headerRowNumber + 1; rowNumber <= headerRowNumber + 6; rowNumber++) {
    const metaValues: string[] = [];
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      metaValues[colNumber - 1] = cellText(cell.value);
    });
    const fromDayRow = parseSalesDateFromRow(metaValues);
    if (fromDayRow) {
      salesDate = fromDayRow;
      break;
    }
  }

  const aggregated = new Map<string, number>();
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
    aggregated.set(itemCode, (aggregated.get(itemCode) ?? 0) + qty);
  }

  const itemCodeColumn = "Item Code";
  const salesQtyColumn = "Sales Qty";
  const rows: ParsedRow[] = [...aggregated.entries()].map(([itemCode, qty], index) => ({
    [itemCodeColumn]: itemCode,
    [salesQtyColumn]: String(qty),
    __rowNumber: String(index + 2),
  }));

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
