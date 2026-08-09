import { parseAllRows } from "@/parsers/file-parser";
import type { ParsedRow } from "@/types";

function toNodeBuffer(buffer: ArrayBuffer | Buffer): Buffer {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(buffer)) {
    return buffer;
  }
  return Buffer.from(buffer as ArrayBuffer);
}

export async function parseSupplierPriceFileBuffer(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
): Promise<{ headers: string[]; rows: ParsedRow[] }> {
  return parseAllRows(toNodeBuffer(buffer), fileName);
}
