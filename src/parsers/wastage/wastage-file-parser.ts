import { isIsoDateString } from "@/utils/iso-date";
import { parse } from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { detectWastageColumns } from "@/parsers/file-parser";
import { tryParseGloposWastageReport } from "@/parsers/wastage/glopos-wastage-report-parser";
import { tryParseGloposStockVarianceWastageReport } from "@/parsers/wastage/glopos-stock-variance-wastage-parser";
import { tryParseMspStockAdjustmentReport } from "@/parsers/wastage/msp-stock-adjustment-parser";
import { isExcludedWastageReason } from "./wastage-reasons";

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
  emptyReport?: boolean;
  referenceColumn?: string;
  quantityColumn?: string;
  wastageDate?: string;
  duplicateRows?: number;
  skippedExcludedReasonRows?: number;
  /** MSP Stock Adjustment or other report already keyed by store product code. */
  storeProductCodeMapped: boolean;
  /** GloPOS WastageReport (may need catalog enrichment). */
  gloposMapped: boolean;
  /** Rows keyed by barcode — resolve to store product codes before import. */
  barcodeMapped: boolean;
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
  identity?: { date?: string; storeName?: string; storeNames?: string[]; storeCode?: string },
): Promise<WastageFileParseResult> {
  assertNotRtcFile(fileName);

  const asBuffer =
    typeof Buffer !== "undefined" && Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer as ArrayBuffer);

  if (/\.xlsx?$/i.test(fileName) && !(
    asBuffer.subarray(0,2).toString() === "PK" || asBuffer.subarray(0,8).toString("hex") === "d0cf11e0a1b11ae1" ||
    /<(?:html|table|\?xml|Workbook)\b/i.test(asBuffer.subarray(0,1000).toString())
  )) throw new Error("Unreadable Wastage workbook; previous data retained");
  // Inspect identity before a specialized parser discards report metadata.
  const workbook = /\.csv$/i.test(fileName) ? null : XLSX.read(asBuffer, { type: "buffer", cellDates: true });
  const grid = workbook ? XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0] ?? ""] ?? {}, {header: 1, defval: "", raw: false}) : parse<unknown[]>(decodeText(buffer), {skipEmptyLines:true}).data;
  const headerIndex = grid.findIndex(row => {
    const headers = row.map(cellText);
    const detected = detectWastageColumns(headers, erpType);
    return !!detected.referenceColumn && !!detected.quantityColumn && detected.referenceColumn !== detected.quantityColumn;
  });
  const text = grid.flat().map(cellText).join(" ");
  const metadataText = (headerIndex < 0 ? grid : grid.slice(0, headerIndex)).flat().map(cellText).join(" ");
  if (/<(?:form|input)\b|password|sign in|log in/i.test(text + asBuffer.subarray(0, 500).toString())) {
    throw new Error("Downloaded file is a login page, not a Wastage report");
  }
  const dates = [...grid.filter(row => !/created|printed|generated/i.test(row.map(cellText).join(" "))).flat().map(cellText).join(" ").matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)]
    .map(m => m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5].padStart(2,"0")}-${m[4].padStart(2,"0")}`);
  // Created/printed timestamps are not business dates. Only date-labelled rows count.
  const reportDates = grid.filter(row => /date\s*(?:range)?\s*:|day\s*:/i.test(row.map(cellText).join(" ")) && !/created|printed|generated/i.test(row.map(cellText).join(" ")))
    .flatMap(row => [...row.map(cellText).join(" ").matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)]
      .map(m => m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5].padStart(2,"0")}-${m[4].padStart(2,"0")}`));
  const businessDates = reportDates.length ? reportDates : dates;
  if (businessDates.some(day => !isIsoDateString(day)) || new Set(businessDates).size > 1) throw new Error("Wastage report must cover one valid day");
  if (identity?.date && businessDates[0] && identity.date !== businessDates[0]) throw new Error("Report date differs from requested date");
  if (identity?.storeNames?.length) {
    const mentioned = identity.storeNames.filter(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(metadataText));
    if (mentioned.some(name => name.toLowerCase() !== identity.storeName?.toLowerCase())) throw new Error("Report contains another store");
  }
  const codes:Record<string,string>={HNS:"0365",PVL:"0766",EAS:"0650",HYS:"0665",GRV:"0566",WTF:"0602",STR:"0388"};
  if (identity?.storeCode) {

    const expected=codes[identity.storeCode]??identity.storeCode;
    const markers=[...metadataText.matchAll(/\b(?:store|branch)\s*(?:code)?\s*[:=-]\s*([A-Z]{3}|\d{4})\b/gi)].map(m=>m[1]);
    if(markers.some(code=>(codes[code.toUpperCase()]??code)!==expected))throw new Error("Report contains another store");
  }
  if (headerIndex >= 0 && (identity?.storeName || identity?.storeCode)) {
    const storeColumn=grid[headerIndex].map(cellText).findIndex(header=>/^(?:store|branch)(?:\s*(?:code|name))?$/i.test(header));
    if(storeColumn>=0)for(const row of grid.slice(headerIndex+1)){
      const marker=cellText(row[storeColumn]);
      if(marker && marker.toLowerCase()!==identity.storeName?.toLowerCase() && marker!==(codes[identity.storeCode??""]??identity.storeCode))throw new Error("Report contains another store");
    }
  }
  const noRecords = grid.some(row => row.some(value => /^no records available[.!]?$/i.test(cellText(value))));
  const emptyRow = (row: unknown[]) => row.every(value => !cellText(value) || /^no records available[.!]?$/i.test(cellText(value)));
  const emptyFooter = (row: unknown[]) => {
    const values=row.map(cellText).filter(Boolean);
    if (/^(?:created|printed|generated)\b/i.test(values[0]??"")) return true;
    return /^(?:grand\s*)?total(?:s|\s*[:=-])?$/i.test(values[0]??"") && values.slice(1).every(value=>/^[-+]?0(?:[.,]0+)?$/.test(value));
  };
  const headerOnly = headerIndex >= 0 && grid.slice(headerIndex + 1).every(row => emptyRow(row) || emptyFooter(row));
  if (noRecords || headerOnly) {
    if (!/wastage|stock\s*adjustment/i.test(text) && !headerOnly) throw new Error("Empty file is not a recognized Wastage report");
    if (/\bsales\b|\brtc\b|sold\s*(?:qty|quantity)|sales\s*date|rtc\s*qty|price\s*override|book\s*stock|current\s*stock|stock\s*valuation|supplier\s*price|unit\s*price|net\s*price/i.test(text)) throw new Error("Empty file is not a recognized Wastage report");
    if (noRecords && headerIndex >= 0 && grid.slice(headerIndex + 1).some(row => !emptyRow(row) && !emptyFooter(row))) throw new Error("Wastage report contains conflicting data and empty markers");
    return { headers: ["Item Code", "Qty"], rows: [], referenceColumn: "Item Code", quantityColumn: "Qty", wastageDate: businessDates[0], emptyReport: true, storeProductCodeMapped: true, gloposMapped: false, barcodeMapped: false };
  }

  const stockVariance = await tryParseGloposStockVarianceWastageReport(
    buffer,
    fileName,
  );
  if (stockVariance) {
    return {
      headers: stockVariance.headers,
      rows: stockVariance.rows,
      referenceColumn: stockVariance.barcodeColumn,
      quantityColumn: stockVariance.quantityColumn,
      wastageDate: stockVariance.wastageDate ?? undefined,
      duplicateRows: stockVariance.duplicateRows,
      skippedExcludedReasonRows: stockVariance.skippedNonWastageRows,
      storeProductCodeMapped: false,
      gloposMapped: true,
      barcodeMapped: true,
    };
  }

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
      barcodeMapped: false,
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
      skippedExcludedReasonRows: msp.skippedExcludedReasonRows,
      storeProductCodeMapped: true,
      gloposMapped: false,
      barcodeMapped: false,
    };
  }

  const lower = fileName.toLowerCase();
  const flat = lower.endsWith(".csv")
    ? parseFlatCsv(buffer)
    : parseFlatSpreadsheet(buffer);
  const detected = detectWastageColumns(flat.headers, erpType);
  const reasonColumn = flat.headers.find(header => /^(?:adjustment\s*)?reason(?:\s*description)?$/i.test(header));
  const rows = reasonColumn
    ? flat.rows.filter(row => !isExcludedWastageReason(row[reasonColumn] ?? ""))
    : flat.rows;
  if (!rows.length && flat.rows.length) throw new Error("No valid wastage rows found; previous data retained");
  if (!flat.rows.length && (!detected.referenceColumn || !detected.quantityColumn)) throw new Error("Empty file is not a recognized Wastage report");
  return {
    ...flat,
    emptyReport: !flat.rows.length,
    rows,
    skippedExcludedReasonRows: flat.rows.length - rows.length,
    referenceColumn: detected.referenceColumn ?? undefined,
    quantityColumn: detected.quantityColumn ?? undefined,
    storeProductCodeMapped: false,
    gloposMapped: false,
    barcodeMapped: false,
  };
}
