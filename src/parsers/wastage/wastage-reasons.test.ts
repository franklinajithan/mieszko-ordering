import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { isExcludedWastageReason } from "./wastage-reasons";
import { parseWastageFileBuffer } from "./wastage-file-parser";

const excluded = ["Store Use", "Stock Correction (+)", "Stock Correction (-)",
  "Stock Adjustment Plus", "Stock Adjustment Minus", "Stock take corrections +",
  "Stock take corrections -", "Stock Transfer", "Store Transfers (Out)",
  "Store Transfers (In)", "Transfers", "Transfer In", "Transfer Out"];
function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "WastageReport");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("Wastage excludes inventory movements", () => {
  it.each(excluded)("excludes %s", reason => expect(isExcludedWastageReason(reason)).toBe(true));
  it.each(["Damaged", "Out of Date"])("retains %s", reason => expect(isExcludedWastageReason(reason)).toBe(false));
  it.each(["Item Code", "Product Code"])("filters grouped %s reports before aggregation", async header => {
    const data: unknown[][] = [[header, "Description", "Qty", "Reason"],
      ["Reason Code: 30 Reason Description: Damaged"], ["M001", "Milk", "1.25"]];
    for (const reason of excluded) data.push([`Reason Code: 99 Reason Description: ${reason}`], ["M001", "Milk", "100"]);
    data.push(["Reason Code: 31 Reason Description: Out of Date"], ["M001", "Milk", "2.5"]);
    const result = await parseWastageFileBuffer(workbook(data), "Wastage_20261014.xls", "msp");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0][result.quantityColumn!]).toBe("3.75");
    expect(result.skippedExcludedReasonRows).toBe(excluded.length);
  });
  it("filters CSV Reason columns", async () => {
    const data = ["Item Code,Qty,Reason", "M001,2,Damaged", ...excluded.map(reason => `M001,100,${reason}`)].join("\n");
    const result = await parseWastageFileBuffer(Buffer.from(data), "wastage.csv");
    expect(result.rows).toHaveLength(1);
    expect(result.skippedExcludedReasonRows).toBe(excluded.length);
  });
  it.each(["Item Code", "Product Code"])("filters %s spreadsheet Reason columns", async header => {
    const result = await parseWastageFileBuffer(workbook([[header, "Description", "Qty", "Reason"],
      ["M001", "Milk", 2, "Damaged"], ...excluded.map(reason => ["M001", "Milk", 100, reason])]), "waste.xls");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0][result.quantityColumn!]).toBe("2");
  });
  it("does not fall back and re-import a report containing only excluded groups", async () => {
    const result = await parseWastageFileBuffer(workbook([["Item Code", "Qty"],
      ["Reason Description: Store Use"], ["M001", "100"]]), "Wastage.xls");
    expect(result.rows).toEqual([]);
    expect(result.skippedExcludedReasonRows).toBe(1);
  });
  it("excludes stock movements from barcode variance reports", async () => {
    const result = await parseWastageFileBuffer(workbook([["Barcode", "QTY Variance", "Reason"],
      ["590000000001", -2, "Damaged"], ...excluded.map(reason => ["590000000001", -100, reason])]), "waste.xls");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0][result.quantityColumn!]).toBe("2");
  });
});
