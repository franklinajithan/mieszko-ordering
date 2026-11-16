import { parseAllRows } from "@/parsers/file-parser";
import type { ParsedRow } from "@/types";

const ITEM_CODE_HEADERS = ["item code", "itemcode", "item_code"];
const QTY_HEADERS = [
  "rec total unit",
  "receive total unit",
  "rec total qty",
  "receive total qty",
  "received total unit",
  "received total qty",
];

function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function detectNotPostedColumns(headers: string[]): {
  itemCodeColumn: string | null;
  quantityColumn: string | null;
} {
  return {
    itemCodeColumn:
      headers.find((header) => ITEM_CODE_HEADERS.includes(norm(header))) ?? null,
    quantityColumn:
      headers.find((header) => QTY_HEADERS.includes(norm(header))) ?? null,
  };
}

export async function parseNotPostedFileBuffer(buffer: Buffer, fileName: string) {
  const parsed = await parseAllRows(buffer, fileName);
  const columns = detectNotPostedColumns(parsed.headers);
  if (!columns.itemCodeColumn || !columns.quantityColumn) {
    throw new Error(
      "Could not find Item Code and Rec Total Unit columns in this delivery file.",
    );
  }
  return {
    ...parsed,
    itemCodeColumn: columns.itemCodeColumn,
    quantityColumn: columns.quantityColumn,
  };
}

export function pivotNotPostedRows(
  rows: ParsedRow[],
  itemCodeColumn: string,
  quantityColumn: string,
): Array<{ itemCode: string; quantity: string; rowNumber: number }> {
  const totals = new Map<string, { quantity: number; rowNumber: number }>();

  for (const row of rows) {
    const itemCode = (row[itemCodeColumn] ?? "").trim();
    const qtyRaw = (row[quantityColumn] ?? "").trim();
    const rowNumber = Number(row.__rowNumber ?? 0);
    if (!itemCode) continue;
    const quantity = Number(qtyRaw.replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity === 0) continue;
    const current = totals.get(itemCode);
    if (current) {
      current.quantity += quantity;
    } else {
      totals.set(itemCode, { quantity, rowNumber });
    }
  }

  return [...totals.entries()].map(([itemCode, value]) => ({
    itemCode,
    quantity: String(value.quantity),
    rowNumber: value.rowNumber,
  }));
}
