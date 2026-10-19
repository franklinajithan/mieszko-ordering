import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normalizeReport } from "../../../automation/normalize-report";

function report(date = "18-10-2026") {
  const rows: unknown[][] = Array.from({ length: 15 }, () => []);
  rows[6] = ["", "Mieszko Hayes\nDate : " + date];
  rows[9] = ["", "Item Code", "", "EAN", "", "Description", "", "Item Group", "", "Qty"];
  rows[10] = ["", "Date : 18/10/2026"];
  rows[11] = ["", "Reason Code : 30  Reason Description : Damaged"];
  rows[12] = ["", "M0001353", "", "5900531001130", "", "Cream", "", "DAIRY", "", "2"];
  rows[13] = ["", "Reason Code : 32  Reason Description : Store Use"];
  rows[14] = ["", "M0006340", "", "4038745641055", "", "Beer", "", "ALCOHOL", "", "3"];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "WastageReport");
  return XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

describe("Hayes MSP wastage normalization", () => {
  it("uses the worksheet report date, not the download timestamp, and excludes Store Use", async () => {
    const result = await normalizeReport({
      buffer: report(), fileName: "0665_UB4 0RS_Wastage_20261019_132634.xlsx",
      source: "wastage", start: "2026-10-18", end: "2026-10-18", erp: "msp",
    });
    expect(result.mapping_type).toBe("store_product_code");
    expect(result.rows).toEqual([{ Code: "M0001353", Date: "2026-10-18", Qty: "2" }]);
  });

  it("rejects a report whose embedded date differs from the queued date", async () => {
    await expect(normalizeReport({
      buffer: report("17-10-2026"), fileName: "0665_UB4 0RS_Wastage_20261019_132634.xlsx",
      source: "wastage", start: "2026-10-18", end: "2026-10-18", erp: "msp",
    })).rejects.toThrow("Report date differs from requested date");
  });
});
