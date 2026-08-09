import { parse } from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { tryParseGloposRtcHistoryReport } from "@/parsers/rtc/glopos-rtc-history-parser";
import { detectRtcColumns } from "@/parsers/file-parser";

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

export type RtcFileParseResult = {
  headers: string[];
  rows: ParsedRow[];
  referenceColumn?: string;
  quantityColumn?: string;
  rtcDate?: string;
  duplicateRows?: number;
  /** True when this is a Price Override / RTC Sales History barcode report. */
  barcodeMapped: boolean;
};

/** Parse an RTC CSV/XLSX — safe for browser and server. */
export async function parseRtcFileBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
  erpType: "glopos" | "msp" = "msp",
): Promise<RtcFileParseResult> {
  const gloposRtc = await tryParseGloposRtcHistoryReport(buffer, fileName);
  if (gloposRtc) {
    return {
      headers: gloposRtc.headers,
      rows: gloposRtc.rows,
      referenceColumn: gloposRtc.barcodeColumn,
      quantityColumn: gloposRtc.quantityColumn,
      rtcDate: gloposRtc.rtcDate ?? undefined,
      duplicateRows: gloposRtc.duplicateRows,
      barcodeMapped: true,
    };
  }

  const lower = fileName.toLowerCase();
  const flat = lower.endsWith(".csv")
    ? parseFlatCsv(buffer)
    : parseFlatSpreadsheet(buffer);
  const detected = detectRtcColumns(flat.headers, erpType);
  return {
    ...flat,
    referenceColumn: detected.referenceColumn ?? undefined,
    quantityColumn: detected.quantityColumn ?? undefined,
    barcodeMapped: false,
  };
}
