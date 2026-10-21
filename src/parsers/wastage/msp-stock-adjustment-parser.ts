import { isExcludedWastageReason, extractWastageReason } from "./wastage-reasons";
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
  const m = raw.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${month}-${day}`;
}

function isJunkCode(code: string): boolean {
  const value = code.trim();
  if (!value) return true;
  return /^(day\s*:|adjustment reason|item code|group by|group level|period type|grand total|created on|stock adjustment|mieszko|\(adjustment)/i.test(
    value,
  );
}

function looksLikeItemCode(code: string): boolean {
  const value = code.trim();
  if (!value || isJunkCode(value)) return false;
  // MSP item codes: numeric, X…, M00…, etc.
  return /^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(value) && !/\s{2,}/.test(value);
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
  try {
    return await parseMspStockAdjustmentReport(buffer, fileName);
  } catch {
    return null;
  }
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
  const sheetName =
    workbook.SheetNames.find((name) =>
      /stock\s*adjustment/i.test(name.replace(/\s+/g, "")),
    ) ?? workbook.SheetNames[0];
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

  for (let r = 0; r < Math.min(grid.length, 40); r += 1) {
    const row = (grid[r] ?? []).map(cellText);
    const codeIdx = row.findIndex((c) => /^item\s*code$/i.test(c));
    const qtyIdx = row.findIndex((c) => /^qty$/i.test(c));
    if (codeIdx >= 0 && qtyIdx >= 0) {
      headerRowIndex = r;
      itemCodeCol = codeIdx;
      qtyCol = qtyIdx;
      reasonCol = row.findIndex(c => /^(?:adjustment\s*)?reason(?:\s*description)?$/i.test(c));
      itemNameCol = row.findIndex((c) => /item\s*name/i.test(c));
      break;
    }
  }

  if (headerRowIndex < 0 || itemCodeCol < 0 || qtyCol < 0) {
    throw new Error(
      "Could not find MSP Stock Adjustment header row (Item Code / Qty)",
    );
  }

  let wastageDate: string | null = null;
  for (let r = 0; r < headerRowIndex; r += 1) {
    const rowText = (grid[r] ?? []).map(cellText).join(" ");
    const fromDateLabel = rowText.match(/Date\s*:\s*([0-9./-]+)/i);
    if (fromDateLabel?.[1]) {
      wastageDate = parseUkDate(fromDateLabel[1]);
      if (wastageDate) break;
    }
  }
  if (!wastageDate) {
    for (let r = headerRowIndex; r < Math.min(grid.length, headerRowIndex + 5); r += 1) {
      const rowText = (grid[r] ?? []).map(cellText).join(" ");
      const dayMatch = rowText.match(/Day\s*:\s*([0-9./-]+)/i);
      if (dayMatch?.[1]) {
        wastageDate = parseUkDate(dayMatch[1]);
        if (wastageDate) break;
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
    { qty: ReturnType<typeof toDecimal>; name: string; rowNumber: number }
  >();
  let duplicateRows = 0;
  let currentReason = "";
  let skippedExcludedReasonRows = 0;

  for (let r = headerRowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    const marker = extractWastageReason(row.map(cellText).join(" "));
    if (marker !== null) { currentReason = marker; continue; }
    const code = cellText(row[itemCodeCol] ?? "");
    if (!looksLikeItemCode(code)) continue;
    if (isExcludedWastageReason((reasonCol >= 0 ? cellText(row[reasonCol]) : "") || currentReason)) {
      skippedExcludedReasonRows += 1;
      continue;
    }

    const qtyRaw = cellText(row[qtyCol] ?? "");
    let qty;
    try {
      qty = toDecimal(qtyRaw);
      if (!qty.isFinite()) continue;
    } catch {
      continue;
    }

    const name =
      itemNameCol >= 0 ? cellText(row[itemNameCol] ?? "") : "";
    const existing = pending.get(code);
    if (existing) {
      existing.qty = existing.qty.plus(qty);
      duplicateRows += 1;
      continue;
    }
    pending.set(code, { qty, name, rowNumber: r + 1 });
  }

  if (!pending.size && !skippedExcludedReasonRows) {
    throw new Error("No wastage product rows found in the Stock Adjustment file.");
  }

  const rows: ParsedRow[] = [...pending.entries()].map(
    ([code, { qty, name, rowNumber }]) => {
      const row: ParsedRow = {
        [WASTAGE_ITEM_CODE_COLUMN]: code,
        [WASTAGE_QTY_COLUMN]: qty.toString(),
        __rowNumber: String(rowNumber),
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
