import { describe, expect, it } from "vitest";
import { Decimal } from "@/utils/decimal";
import {
  aggregatePeriodSales,
  boundingIsoRange,
  buildDailySalesByProductMap,
  calculateOrderSheetSuggestedQty,
  listDatesInclusive,
  scaleSoldQtyForShortfall,
  sumQtyInDateRange,
  totalUniquePeriodDays,
} from "@/utils/orderSheetCalculations";

describe("orderSheetCalculations", () => {
  it("aggregates period sales using average", () => {
    const result = aggregatePeriodSales(
      [new Decimal(45), new Decimal(42), new Decimal(40)],
      "average",
    );
    expect(result.toNumber()).toBeCloseTo(42.33, 2);
  });

  it("scales sold qty for longer shortfall periods", () => {
    const scaled = scaleSoldQtyForShortfall({
      baseSoldQty: new Decimal(42),
      comparisonPeriodDays: 7,
      shortfallDays: 10,
    });
    expect(scaled.toNumber()).toBeCloseTo(60, 0);
  });

  it("never returns negative suggested order qty", () => {
    const qty = calculateOrderSheetSuggestedQty({
      requiredQuantityForShortfall: new Decimal(10),
      currentStock: new Decimal(20),
      wastageQty: new Decimal(0),
      rtcQty: new Decimal(0),
      includeWastage: false,
      includeRtc: false,
    });
    expect(qty.toNumber()).toBe(0);
  });

  it("orders enough to cover shortfall after projected stock at delivery", () => {
    const qty = calculateOrderSheetSuggestedQty({
      requiredQuantityForShortfall: new Decimal(30),
      currentStock: new Decimal(7),
      wastageQty: new Decimal(0),
      rtcQty: new Decimal(0),
      includeWastage: false,
      includeRtc: false,
    });
    expect(qty.toNumber()).toBe(23);
  });

  it("counts unique days across overlapping shortfall periods", () => {
    expect(
      totalUniquePeriodDays([
        { startDate: "2026-09-10", endDate: "2026-09-15" },
        { startDate: "2026-09-14", endDate: "2026-09-16" },
      ]),
    ).toBe(7);
  });

  it("lists each date in an inclusive range", () => {
    expect(listDatesInclusive("2026-08-19", "2026-08-21")).toEqual([
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);
  });

  it("maps daily sales rows by store product and date", () => {
    const map = buildDailySalesByProductMap([
      { storeProductId: 1, salesDate: "2026-08-19", soldQty: "5" },
      { storeProductId: 1, salesDate: "2026-08-20", soldQty: "3" },
    ]);
    expect(map.get(1)?.get("2026-08-19")).toBe("5");
    expect(map.get(1)?.get("2026-08-20")).toBe("3");
  });

  it("sums quantities inside an inclusive date range", () => {
    const byDate = new Map([
      ["2026-08-18", "2"],
      ["2026-08-19", "5"],
      ["2026-08-20", "3"],
      ["2026-08-21", "9"],
    ]);
    expect(sumQtyInDateRange(byDate, "2026-08-19", "2026-08-20").toNumber()).toBe(8);
    expect(sumQtyInDateRange(undefined, "2026-08-19", "2026-08-20").toNumber()).toBe(0);
  });

  it("returns the bounding date range across periods", () => {
    expect(
      boundingIsoRange([
        { startDate: "2026-08-10", endDate: "2026-08-12" },
        { startDate: "2026-08-01", endDate: "2026-08-03" },
      ]),
    ).toEqual({ startDate: "2026-08-01", endDate: "2026-08-12" });
  });
});
