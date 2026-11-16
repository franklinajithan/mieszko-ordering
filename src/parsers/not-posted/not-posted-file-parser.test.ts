import { describe, expect, it } from "vitest";
import {
  detectNotPostedColumns,
  pivotNotPostedRows,
} from "@/parsers/not-posted/not-posted-file-parser";

describe("not-posted file parser", () => {
  it("detects Item Code and Rec Total Unit columns", () => {
    expect(
      detectNotPostedColumns([
        "Line #",
        "Item Code",
        "Item Name (Long)",
        "Rec Total Unit",
        "Total Net Cost (Incl. Surcharge)",
      ]),
    ).toEqual({
      itemCodeColumn: "Item Code",
      quantityColumn: "Rec Total Unit",
    });
  });

  it("sums receive qty by item code and skips zeros", () => {
    const pivoted = pivotNotPostedRows(
      [
        { ItemCode: "M0008139", Qty: "40", __rowNumber: "2" },
        { ItemCode: "M0008139", Qty: "5", __rowNumber: "3" },
        { ItemCode: "3411", Qty: "0", __rowNumber: "4" },
        { ItemCode: "M0022205", Qty: "5.654", __rowNumber: "5" },
      ].map((row) => ({
        "Item Code": row.ItemCode,
        "Rec Total Unit": row.Qty,
        __rowNumber: row.__rowNumber,
      })),
      "Item Code",
      "Rec Total Unit",
    );

    expect(pivoted).toEqual([
      { itemCode: "M0008139", quantity: "45", rowNumber: 2 },
      { itemCode: "M0022205", quantity: "5.654", rowNumber: 5 },
    ]);
  });
});
