import { describe, expect, it } from "vitest";
import {
  detectFutureOcsColumns,
  pivotFutureOcsRows,
} from "@/parsers/future-deliveries/future-delivery-file-parser";

describe("future OCS file parser", () => {
  it("detects Item Code and Del Total Unit", () => {
    expect(
      detectFutureOcsColumns([
        "Line #",
        "Item Code",
        "Del Total Unit",
        "Rec Total Unit",
      ]),
    ).toEqual({
      itemCodeColumn: "Item Code",
      quantityColumn: "Del Total Unit",
    });
  });

  it("sums Del Total Unit and skips zeros", () => {
    const pivoted = pivotFutureOcsRows(
      [
        { "Item Code": "M0007495", "Del Total Unit": "20", __rowNumber: "2" },
        { "Item Code": "M0007495", "Del Total Unit": "4", __rowNumber: "3" },
        { "Item Code": "61925", "Del Total Unit": "0", __rowNumber: "4" },
        { "Item Code": "M0029908", "Del Total Unit": "2.056", __rowNumber: "5" },
      ],
      "Item Code",
      "Del Total Unit",
    );

    expect(pivoted).toEqual([
      { itemCode: "M0007495", quantity: "24", rowNumber: 2 },
      { itemCode: "M0029908", quantity: "2.056", rowNumber: 5 },
    ]);
  });
});
