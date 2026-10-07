import { parseAllRows } from "@/parsers/file-parser";
import { pivotNotPostedRows } from "@/parsers/not-posted/not-posted-file-parser";
import type { ParsedRow } from "@/types";

const ITEM_CODE_HEADERS = ["item code", "itemcode", "item_code"];
const QTY_HEADERS = [
  "del total unit",
  "delivery total unit",
  "del total qty",
  "delivery total qty",
  "delivered total unit",
];

function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function detectFutureOcsColumns(headers: string[]): {
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

export async function parseFutureOcsFileBuffer(buffer: Buffer, fileName: string) {
  const parsed = await parseAllRows(buffer, fileName);
  const columns = detectFutureOcsColumns(parsed.headers);
  if (!columns.itemCodeColumn || !columns.quantityColumn) {
    throw new Error(
      "Could not find Item Code and Del Total Unit columns in this future delivery file.",
    );
  }
  return {
    ...parsed,
    itemCodeColumn: columns.itemCodeColumn,
    quantityColumn: columns.quantityColumn,
  };
}

export function pivotFutureOcsRows(
  rows: ParsedRow[],
  itemCodeColumn: string,
  quantityColumn: string,
) {
  return pivotNotPostedRows(rows, itemCodeColumn, quantityColumn);
}
