import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import { formatSpreadsheetBarcode } from "@/utils/barcode";
import { toDecimal } from "@/utils/decimal";

export const PROMO_BARCODE_COLUMN = "Barcode";
export const PROMO_QTY_COLUMN = "Promo Qty";

export type MspPromotionItemDetailParseResult = {
  headers: string[];
  rows: ParsedRow[];
  barcodeColumn: string;
  quantityColumn: string;
  promoDate: string | null;
  duplicateRows: number;
  skippedTotalRows: number;
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value).trim();
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normHeader(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function findHeaderIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => {
    const n = normHeader(header);
    return n && patterns.some((pattern) => pattern.test(n));
  });
}

function parseUkDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${month}-${day}`;
}

function parsePromoDateFromFileName(fileName: string): string | null {
  const match = fileName.match(/_(\d{4})(\d{2})(\d{2})_/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isJunkBarcodeRow(barcode: string): boolean {
  const value = barcode.trim();
  if (!value) return true;
  return /^(promotion\s*(group|name)\s*:|total\s*:|sub\s*total\s*:|grand\s*total\s*:|barcode)$/i.test(
    value,
  );
}

/** MSP Promotion Item Detail reports (Barcode + Promo Qty). */
export function isMspPromotionItemDetailReport(
  headers: string[],
  fileName = "",
): boolean {
  if (/promotion\s*item\s*detail/i.test(fileName)) return true;
  const joined = headers.map(normHeader).filter(Boolean).join(" | ");
  if (!joined) return false;
  return (
    /\bbarcode\b/.test(joined) &&
    (/promo\s*qty/.test(joined) || /promotion\s*qty/.test(joined))
  );
}

export async function tryParseMspPromotionItemDetailReport(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<MspPromotionItemDetailParseResult | null> {
  try {
    return await parseMspPromotionItemDetailReport(buffer, fileName);
  } catch {
    return null;
  }
}

/**
 * Parse MSP Promotion Item Detail Excel.
 * Duplicate barcodes are summed on Promo Qty before import.
 */
export async function parseMspPromotionItemDetailReport(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<MspPromotionItemDetailParseResult> {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellStyles: false,
    cellNF: false,
    sheetStubs: false,
  });
  const sheetName =
    workbook.SheetNames.find((name) =>
      /promotion/i.test(name.replace(/\s+/g, "")),
    ) ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheets");

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  let headerRowIndex = -1;
  let barcodeCol = -1;
  let promoQtyCol = -1;
  let nameCol = -1;

  for (let r = 0; r < Math.min(grid.length, 40); r += 1) {
    const row = (grid[r] ?? []).map(cellText);
    const barcodeIdx = findHeaderIndex(row, [/^barcode$/]);
    const qtyIdx = findHeaderIndex(row, [/^promo\s*qty$/, /^promotion\s*qty$/]);
    if (barcodeIdx >= 0 && qtyIdx >= 0) {
      headerRowIndex = r;
      barcodeCol = barcodeIdx;
      promoQtyCol = qtyIdx;
      nameCol = findHeaderIndex(row, [/^item\s*name$/, /^description$/]);
      break;
    }
  }

  if (headerRowIndex < 0 || barcodeCol < 0 || promoQtyCol < 0) {
    throw new Error(
      "Could not find Promotion Item Detail header row (Barcode / Promo Qty)",
    );
  }

  let promoDate: string | null = parsePromoDateFromFileName(fileName);
  for (let r = 0; r < headerRowIndex; r += 1) {
    const rowText = (grid[r] ?? []).map(cellText).join(" ");
    const fromLabel = rowText.match(/Date\s*:\s*([0-9./-]+)/i);
    if (fromLabel?.[1]) {
      promoDate = parseUkDate(fromLabel[1]) ?? promoDate;
      if (promoDate) break;
    }
  }

  const pending = new Map<string, ParsedRow>();
  let duplicateRows = 0;
  let skippedTotalRows = 0;

  for (let r = headerRowIndex + 1; r < grid.length; r += 1) {
    const rowValues = (grid[r] ?? []).map(cellText);
    const barcode = formatSpreadsheetBarcode(rowValues[barcodeCol] ?? "").trim();
    if (!barcode || isJunkBarcodeRow(barcode)) {
      if (barcode && /total/i.test(barcode)) skippedTotalRows += 1;
      continue;
    }

    const qtyRaw = (rowValues[promoQtyCol] ?? "").replace(/,/g, "").trim();
    if (!qtyRaw) continue;

    let promoQty;
    try {
      promoQty = toDecimal(qtyRaw);
      if (!promoQty.isFinite() || promoQty.lte(0)) {
        skippedTotalRows += 1;
        continue;
      }
    } catch {
      skippedTotalRows += 1;
      continue;
    }

    const existing = pending.get(barcode);
    if (existing) {
      try {
        const sum = toDecimal(existing[PROMO_QTY_COLUMN] ?? "0").plus(promoQty);
        existing[PROMO_QTY_COLUMN] = sum.toString();
      } catch {
        existing[PROMO_QTY_COLUMN] = promoQty.toString();
      }
      duplicateRows += 1;
      continue;
    }

    const productName = nameCol >= 0 ? (rowValues[nameCol] ?? "").trim() : "";
    pending.set(barcode, {
      [PROMO_BARCODE_COLUMN]: barcode,
      [PROMO_QTY_COLUMN]: promoQty.toString(),
      ...(productName ? { __productName: productName } : {}),
      __rowNumber: String(r + 1),
    });
  }

  if (!pending.size) {
    throw new Error("No promo rows found (need Barcode + Promo Qty).");
  }

  return {
    headers: [PROMO_BARCODE_COLUMN, PROMO_QTY_COLUMN],
    rows: [...pending.values()],
    barcodeColumn: PROMO_BARCODE_COLUMN,
    quantityColumn: PROMO_QTY_COLUMN,
    promoDate,
    duplicateRows,
    skippedTotalRows,
  };
}
