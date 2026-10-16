import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWastageFileBuffer } from "./wastage-file-parser";

describe("MSP Wastage empty report validation", () => {
  it.each(["xls", "xlsx", "XLS"])("rejects a No Records Available %s report instead of recording zero wastage", async (extension) => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["", "", "", "", "Wastage"],
      ["Mieszko Hayes - Date Range: 15-10-2026 to 15-10-2026"],
      ["No Records Available"],
    ]);
    XLSX.utils.book_append_sheet(book, sheet, "Wastage");
    const bytes = XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;
    await expect(parseWastageFileBuffer(bytes, `Hayes_Wastage_20261015.${extension}`, "msp"))
      .rejects.toThrow(/No Records Available/);
  });
});
