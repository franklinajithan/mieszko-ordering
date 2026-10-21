import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWastageFileBuffer } from "./wastage-file-parser";

describe("MSP Wastage empty report validation", () => {
  it.each(["xls", "xlsx", "XLS"])("accepts a recognized No Records Available %s report as zero wastage", async (extension) => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["", "", "", "", "Wastage"],
      ["Mieszko Hayes - Date Range: 15-10-2026 to 15-10-2026"],
      ["No Records Available"],
    ]);
    XLSX.utils.book_append_sheet(book, sheet, "Wastage");
    const bytes = XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;
    await expect(parseWastageFileBuffer(bytes, `Hayes_Wastage_20261015.${extension}`, "msp"))
      .resolves.toMatchObject({rows:[],emptyReport:true,wastageDate:"2026-10-15"});
  });
  it("still rejects an empty message belonging to an unrelated report",async()=>{
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Sales"],["No Records Available"]]),"Sales");
    await expect(parseWastageFileBuffer(XLSX.write(book,{type:"buffer",bookType:"xlsx"}),"report.xlsx","msp")).rejects.toThrow("recognized Wastage report");
  });
});
