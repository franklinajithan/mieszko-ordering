import { parse } from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { detectWastageColumns } from "@/parsers/file-parser";
import { tryParseGloposWastageReport } from "@/parsers/glopos-wastage-report-parser";
import { tryParseMspStockAdjustmentReport } from "@/parsers/msp-stock-adjustment-parser";

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

export type WastageFileParseResult = {
  headers: string[];
  rows: ParsedRow[];
  referenceColumn?: string;
  quantityColumn?: string;
  wastageDate?: string;
  duplicateRows?: number;
  skippedExcludedReasonRows?: number;
  /** MSP Stock Adjustment or other report already keyed by store product code. */
  storeProductCodeMapped: boolean;
  /** GloPOS WastageReport (may need catalog enrichment). */
  gloposMapped: boolean;
};

function assertNotRtcFile(fileName: string) {
  if (/rtc|price\s*override/i.test(fileName)) {
    throw new Error(
      "This looks like an RTC / Price Override file. Use the RTC import page for that report, or upload an MSP Stock Adjustment / GloPOS WastageReport.",
    );
  }
}

/** Parse a wastage CSV/XLSX — safe for browser and server. */
export async function parseWastageFileBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
  erpType: "glopos" | "msp" = "msp",
): Promise<WastageFileParseResult> {
  assertNotRtcFile(fileName);

  const asBuffer =
    typeof Buffer !== "undefined" && Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer as ArrayBuffer);

  const glopos = await tryParseGloposWastageReport(asBuffer, fileName);
  if (glopos) {
    return {
      headers: glopos.headers,
      rows: glopos.rows,
      referenceColumn: glopos.productCodeColumn,
      quantityColumn: glopos.quantityColumn,
      wastageDate: glopos.wastageDate ?? undefined,
      duplicateRows: glopos.duplicateRows,
      skippedExcludedReasonRows: glopos.skippedExcludedReasonRows,
      storeProductCodeMapped: true,
      gloposMapped: true,
    };
  }

  const msp = await tryParseMspStockAdjustmentReport(buffer, fileName);
  if (msp) {
    return {
      headers: msp.headers,
      rows: msp.rows,
      referenceColumn: msp.itemCodeColumn,
      quantityColumn: msp.quantityColumn,
      wastageDate: msp.wastageDate ?? undefined,
      duplicateRows: msp.duplicateRows,
      storeProductCodeMapped: true,
      gloposMapped: false,
    };
  }

  const lower = fileName.toLowerCase();
  const flat = lower.endsWith(".csv")
    ? parseFlatCsv(buffer)
    : parseFlatSpreadsheet(buffer);
  const detected = detectWastageColumns(flat.headers, erpType);
  return {
    ...flat,
    referenceColumn: detected.referenceColumn ?? undefined,
    quantityColumn: detected.quantityColumn ?? undefined,
    storeProductCodeMapped: false,
    gloposMapped: false,
  };
}
