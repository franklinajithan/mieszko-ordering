import * as XLSX from "xlsx";
import { normalizeProductCode } from "@/parsers/product-file-parser";

export type SupplierCodeFileErp = "msp" | "glopos";

/** Blank / deferred = null. Confirmed gap vs real code. */
export type SupplierCodeCell =
  | { kind: "code"; value: string }
  | { kind: "unavailable" };

export type SupplierCodeFileRow = {
  storeProductCode: string;
  mm: SupplierCodeCell | null;
  sp: SupplierCodeCell | null;
  wab: SupplierCodeCell | null;
  rowNumber: number;
};

export type SupplierCodeFileParseResult = {
  headers: string[];
  rows: SupplierCodeFileRow[];
  erpType: SupplierCodeFileErp;
  storeCodeColumn: string;
  mmColumn: string | null;
  spColumn: string | null;
  wabColumn: string | null;
};

type SpreadsheetBytes = ArrayBuffer | Buffer;

/** UTF-8 / Unicode NFC — preserves Polish characters in WAB codes (ł, ę, ó, …). */
export function normalizeUtf8SupplierCode(value: string): string {
  let code = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!code) return "";
  if (/^\d+\.0+$/.test(code)) {
    code = code.replace(/\.0+$/, "");
  }
  return code;
}

/** Case-insensitive key for conflict / lookup (Polish locale). */
export function supplierCodeCompareKey(code: string): string {
  return code.normalize("NFC").toLocaleLowerCase("pl-PL");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value).trim();
  }
  // Keep Unicode as JS string (UTF-8 on the wire); only collapse whitespace.
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function readWorkbook(
  bytes: SpreadsheetBytes,
  fileName = "",
): XLSX.WorkBook {
  const lower = fileName.toLowerCase();
  // codepage 65001 = UTF-8 (needed for WAB codes with Polish letters)
  const base = {
    cellDates: true,
    cellStyles: false,
    cellNF: false,
    sheetStubs: false,
    codepage: 65001,
  } as const;

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(bytes)) {
    if (lower.endsWith(".csv")) {
      // Decode as UTF-8 explicitly so Polish characters are not latin1-mojibake.
      const text = bytes.toString("utf8");
      return XLSX.read(text, { ...base, type: "string" });
    }
    return XLSX.read(bytes, { ...base, type: "buffer" });
  }

  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(bytes);
    return XLSX.read(text, { ...base, type: "string" });
  }
  return XLSX.read(bytes, { ...base, type: "array" });
}

function findHeaderRowIndex(grid: unknown[][]): number {
  for (let rowIndex = 0; rowIndex < Math.min(grid.length, 40); rowIndex += 1) {
    const values = (grid[rowIndex] ?? []).map(cellText).map(normHeader);
    const hasProductCode = values.some(
      (v) => v === "productcode" || v === "product code",
    );
    const hasId = values.some((v) => v === "id");
    const hasMm = values.some((v) => v === "mm code" || v === "mmcode");
    const hasSp = values.some((v) => v === "sp code" || v === "spcode");
    const hasWab = values.some(
      (v) => v === "wab code" || v === "wabcode" || v === "wabar code",
    );
    if ((hasProductCode || hasId) && (hasMm || hasSp || hasWab)) {
      return rowIndex;
    }
  }
  return -1;
}

function findColumnIndex(headers: string[], patterns: string[]): number {
  for (let index = 0; index < headers.length; index += 1) {
    const header = normHeader(headers[index] ?? "");
    if (!header) continue;
    if (patterns.some((pattern) => header === pattern)) return index;
  }
  return -1;
}

/** Blank or "keep existing" — do not write (not finalized). */
export function isDeferredSupplierCode(raw: string): boolean {
  const lower = raw.trim().toLocaleLowerCase("pl-PL").replace(/\s+/g, " ");
  return !lower || lower === "keep";
}

/**
 * Confirmed “not available with that supplier” markers from HO spreadsheets
 * or manual entry (Not in MM, Not with SP, No WAB, …).
 */
export function isUnavailableSupplierMarker(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  const lower = value.toLocaleLowerCase("pl-PL").replace(/\s+/g, " ").trim();
  if (
    lower === "n/a" ||
    lower === "na" ||
    lower === "-" ||
    lower === "namm" ||
    lower === "not available" ||
    lower === "not available?" ||
    lower === "not availabe?"
  ) {
    return true;
  }
  if (lower.startsWith("not in") || lower.startsWith("not with")) return true;
  if (/^no (mm|sp|wab|warbar|wabar)$/.test(lower)) return true;
  return false;
}

/** @deprecated Prefer parseSupplierCodeCell — kept for callers that only need a boolean. */
export function isJunkSupplierCode(raw: string): boolean {
  if (isDeferredSupplierCode(raw)) return true;
  return isUnavailableSupplierMarker(raw);
}

export function parseSupplierCodeCell(raw: string): SupplierCodeCell | null {
  const code = normalizeUtf8SupplierCode(raw);
  if (!code || isDeferredSupplierCode(code)) return null;
  if (isUnavailableSupplierMarker(code)) return { kind: "unavailable" };
  return { kind: "code", value: code };
}

export function normalizeSupplierCode(raw: string): string | null {
  const cell = parseSupplierCodeCell(raw);
  return cell?.kind === "code" ? cell.value : null;
}

export function supplierCodeCellLabel(cell: SupplierCodeCell | null): string {
  if (!cell) return "";
  if (cell.kind === "unavailable") return "(unavailable)";
  return cell.value;
}

/**
 * Parse HO supplier-code spreadsheets (MSP ProductCode or GloPOS ID + MM/SP/WAB).
 * WAB codes may include Polish UTF-8 characters (e.g. Sło…, Węd…).
 */
export async function parseSupplierCodeFileBuffer(
  buffer: SpreadsheetBytes,
  fileName = "",
): Promise<SupplierCodeFileParseResult> {
  const workbook = readWorkbook(buffer, fileName);
  const preferred =
    workbook.SheetNames.find((name) => /product/i.test(name)) ??
    workbook.SheetNames[0];
  if (!preferred) throw new Error("Workbook has no worksheets");

  const sheet = workbook.Sheets[preferred];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  const headerRowIndex = findHeaderRowIndex(grid);
  if (headerRowIndex < 0) {
    throw new Error(
      "Could not find supplier-code header row (ProductCode/ID + MM/SP/WAB codes)",
    );
  }

  const headers = (grid[headerRowIndex] ?? []).map(cellText);
  const productCodeIndex = findColumnIndex(headers, [
    "productcode",
    "product code",
  ]);
  const idIndex = findColumnIndex(headers, ["id"]);
  const storeCodeIndex = productCodeIndex >= 0 ? productCodeIndex : idIndex;
  if (storeCodeIndex < 0) {
    throw new Error("File is missing ProductCode or ID column");
  }

  const mmIndex = findColumnIndex(headers, ["mm code", "mmcode"]);
  const spIndex = findColumnIndex(headers, ["sp code", "spcode"]);
  const wabIndex = findColumnIndex(headers, [
    "wab code",
    "wabcode",
    "wabar code",
  ]);
  if (mmIndex < 0 && spIndex < 0 && wabIndex < 0) {
    throw new Error("File is missing MM / SP / WAB code columns");
  }

  const erpType: SupplierCodeFileErp =
    productCodeIndex >= 0 ? "msp" : "glopos";

  const rows: SupplierCodeFileRow[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const rowValues = grid[rowIndex] ?? [];
    if (!rowValues.some((cell) => cellText(cell))) continue;

    const storeProductCode = normalizeProductCode(
      cellText(rowValues[storeCodeIndex] ?? ""),
    );
    if (!storeProductCode) continue;

    rows.push({
      storeProductCode,
      mm:
        mmIndex >= 0
          ? parseSupplierCodeCell(cellText(rowValues[mmIndex] ?? ""))
          : null,
      sp:
        spIndex >= 0
          ? parseSupplierCodeCell(cellText(rowValues[spIndex] ?? ""))
          : null,
      wab:
        wabIndex >= 0
          ? parseSupplierCodeCell(cellText(rowValues[wabIndex] ?? ""))
          : null,
      rowNumber: rowIndex + 1,
    });
  }

  return {
    headers,
    rows,
    erpType,
    storeCodeColumn:
      headers[storeCodeIndex] ?? (erpType === "msp" ? "ProductCode" : "ID"),
    mmColumn: mmIndex >= 0 ? headers[mmIndex]! : null,
    spColumn: spIndex >= 0 ? headers[spIndex]! : null,
    wabColumn: wabIndex >= 0 ? headers[wabIndex]! : null,
  };
}
