import { isExcludedWastageReason, extractWastageReason } from "./wastage-reasons";
import { isIsoDateString } from "@/utils/iso-date";
import * as XLSX from "xlsx";
import type { ParsedRow } from "@/types";
import {
  WASTAGE_ITEM_CODE_COLUMN,
  WASTAGE_QTY_COLUMN,
} from "@/lib/import-config";
import { toDecimal } from "@/utils/decimal";

export type MspStockAdjustmentParseResult = {
  headers: string[];
  rows: ParsedRow[];
  itemCodeColumn: string;
  quantityColumn: string;
  wastageDate: string | null;
  duplicateRows: number;
  skippedExcludedReasonRows: number;
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value).trim();
  }
  return String(value).trim();
}

function parseUkDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isIsoDateString(raw) ? raw : null;
  const m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  const result = `${year}-${month}-${day}`;
  return isIsoDateString(result) ? result : null;
}

function isJunkCode(code: string): boolean {
  const value = code.trim();
  if (!value) return true;
  return /^((?:day|date)\s*:|reason code|total for|adjustment reason|item code|group by|group level|period type|grand total|created on|stock adjustment|mieszko|\(adjustment)/i.test(
    value,
  );
}

function looksLikeItemCode(code: string): boolean {
  const value = code.trim();
  if (!value || isJunkCode(value)) return false;
  // MSP item codes: numeric, X…, M00…, etc.
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !/\s{2,}/.test(value);
}

export function isMspStockAdjustmentReport(
  headers: string[],
  fileName: string,
): boolean {
  if (/stock\s*adjustment/i.test(fileName)) return true;
  const joined = headers.map((h) => h.toLowerCase()).join(" | ");
  return (
    joined.includes("item code") &&
    joined.includes("qty") &&
    (joined.includes("st. before") ||
      joined.includes("adj. amt") ||
      /stock\s*adjustment/i.test(joined))
  );
}

export async function tryParseMspStockAdjustmentReport(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<MspStockAdjustmentParseResult | null> {
  if (/\.csv$/i.test(fileName)) return null;
  const book = XLSX.read(buffer, {type:'buffer'});
  const recognized = book.SheetNames.some(name => {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], {header:1,defval:''});
    return grid.slice(0,80).some(row => row.some(value => /^item\s*code$/i.test(cellText(value)))
      && row.some(value => /^(?:qty|quantity)$/i.test(cellText(value))));
  });
  return recognized ? parseMspStockAdjustmentReport(buffer, fileName) : null;
}

/**
 * Parse MSP Stock Adjustment Excel (sparse report layout).
 * Rows keyed by Item Code; Qty is the adjustment quantity.
 * Duplicate item codes are summed.
 */
export async function parseMspStockAdjustmentReport(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<MspStockAdjustmentParseResult> {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellStyles: false,
    cellNF: false,
    sheetStubs: false,
  });
  const sheetName = workbook.SheetNames.find(name => {
    const cells = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {header:1,defval:''});
    return cells.slice(0,80).some(row => row.some(value => /^item\s*code$/i.test(cellText(value)))
      && row.some(value => /^(?:qty|quantity)$/i.test(cellText(value))));
  }) ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheets");

  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  let headerRowIndex = -1;
  let itemCodeCol = -1;
  let itemNameCol = -1;
  let qtyCol = -1;
  let reasonCol = -1;
  let barcodeCol = -1;

  for (let r = 0; r < Math.min(grid.length, 80); r += 1) {
    const row = (grid[r] ?? []).map(cellText);
    const codeIdx = row.findIndex((c) => /^item\s*code$/i.test(c));
    const qtyIdx = row.findIndex((c) => /^(?:qty|quantity)$/i.test(c));
    if (codeIdx >= 0 && qtyIdx >= 0) {
      headerRowIndex = r;
      itemCodeCol = codeIdx;
      barcodeCol = row.findIndex(c => /^(?:ean|barcode|gtin)$/i.test(c));
      qtyCol = qtyIdx;
      reasonCol = row.findIndex(c => /^(?:adjustment\s*)?reason(?:\s*description)?$/i.test(c));
      itemNameCol = row.findIndex((c) => /^(?:item\s*name|description)$/i.test(c));
      break;
    }
  }

  if (headerRowIndex < 0 || itemCodeCol < 0 || qtyCol < 0) {
    throw new Error(
      "Could not find MSP Stock Adjustment header row (Item Code / Qty)",
    );
  }

  let wastageDate: string | null = null;
  // Check every explicit report day/range, including repeated page/group markers.
  for (let r = 0; r < grid.length; r++) {
    const text = (grid[r] ?? []).map(cellText).join('\n');
    const matches = [...text.matchAll(/(?:^|\n)\s*(?:date(?:\s*range)?|day)\s*:\s*([0-9./-]+)(?:\s+(?:to|-)\s+([0-9./-]+))?/gi)];
    for (const match of matches) {
      for (const raw of [match[1],match[2]].filter(Boolean)) {
        const day = parseUkDate(raw);
        if (!day) throw new Error(`${fileName}: row ${r+1}, Date: invalid calendar date`);
        if (wastageDate && wastageDate !== day) throw new Error(`${fileName}: row ${r+1}, Date: multiple days in daily Wastage report`);
        wastageDate = day;
      }
    }
  }
  if (!wastageDate) {
    const fromName = fileName.match(/(\d{8})/);
    if (fromName) {
      const raw = fromName[1];
      wastageDate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
  }

  const pending = new Map<
    string,
    { qty: ReturnType<typeof toDecimal>; name: string; rowNumber: number; reasons: Set<string>; barcodes: Set<string> }
  >();
  let duplicateRows = 0;
  let currentReason = "";
  let skippedExcludedReasonRows = 0;

  for (let r = headerRowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const marker = extractWastageReason(row.map(cellText).join(" "));
    if (marker !== null) { currentReason = marker; continue; }
    const code = cellText(row[itemCodeCol] ?? "");
    if (!looksLikeItemCode(code)) {
      if (!isJunkCode(code) || (!code && cellText(row[qtyCol]) && itemNameCol >= 0 && cellText(row[itemNameCol]))) {
        throw new Error(`${fileName}: row ${r+1}, Item Code: missing or invalid product identifier`);
      }
      continue;
    }
    if (isExcludedWastageReason((reasonCol >= 0 ? cellText(row[reasonCol]) : "") || currentReason)) {
      skippedExcludedReasonRows += 1;
      continue;
    }

    const qtyRaw = cellText(row[qtyCol] ?? "");
    // Commas are thousands separators only; reject ambiguous decimal commas.
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(qtyRaw)) {
      throw new Error(`${fileName}: row ${r+1}, Qty: invalid decimal quantity for ${code}`);
    }
    let qty;
    try {
      qty = toDecimal(qtyRaw.replace(/,/g, ""));
      if (!qty.isFinite() || qty.isNegative() || qty.decimalPlaces() > 4) throw new Error("invalid");
    } catch {
      throw new Error(`${fileName}: row ${r+1}, Qty: expected non-negative quantity with at most four decimal places for ${code}`);
    }

    const name =
      itemNameCol >= 0 ? cellText(row[itemNameCol] ?? "") : "";
    const reason = (reasonCol >= 0 ? cellText(row[reasonCol]) : "") || currentReason;
    const barcode = barcodeCol >= 0 ? cellText(row[barcodeCol]) : '';
    if (barcodeCol >= 0 && typeof row[barcodeCol] === 'number' && !Number.isSafeInteger(row[barcodeCol])) {
      throw new Error(`${fileName}: row ${r+1}, Barcode: unsafe numeric identifier; export as text`);
    }
    const existing = pending.get(code);
    if (existing) {
      existing.qty = existing.qty.plus(qty);
      if (reason) existing.reasons.add(reason);
      if (barcode) existing.barcodes.add(barcode);
      duplicateRows += 1;
      continue;
    }
    pending.set(code, { qty, name, rowNumber: r + 1, reasons: new Set(reason ? [reason] : []), barcodes: new Set(barcode ? [barcode] : []) });
  }

  if (!pending.size && !skippedExcludedReasonRows) {
    throw new Error("No wastage product rows found in the Stock Adjustment file.");
  }

  const rows: ParsedRow[] = [...pending.entries()].map(
    ([code, { qty, name, rowNumber, reasons, barcodes }]) => {
      const row: ParsedRow = {
        [WASTAGE_ITEM_CODE_COLUMN]: code,
        [WASTAGE_QTY_COLUMN]: qty.toString(),
        __rowNumber: String(rowNumber),
        __wastageReasons: JSON.stringify([...reasons]),
        __barcodes: JSON.stringify([...barcodes]),
      };
      if (name) row.__productName = name;
      return row;
    },
  );

  return {
    headers: [WASTAGE_ITEM_CODE_COLUMN, WASTAGE_QTY_COLUMN],
    rows,
    itemCodeColumn: WASTAGE_ITEM_CODE_COLUMN,
    quantityColumn: WASTAGE_QTY_COLUMN,
    wastageDate,
    duplicateRows,
    skippedExcludedReasonRows,
  };
}
