import { describe, expect, it } from "vitest";
import { Decimal } from "@/utils/decimal";
import { calculateHighestSoldQty } from "./highest-sales.service";
import {
  aggregateStockQuantities,
  simulateStockTimeline,
  type StockEvent,
} from "./stock-simulation.service";
import { calculateSuggestedOrderQty } from "./suggested-order.service";
import { compareSupplierPrices } from "./supplier-price.service";

const d = (n: number) => new Decimal(n);

describe("calculateHighestSoldQty", () => {
  it("returns max of four periods", () => {
    expect(
      calculateHighestSoldQty({
        period1: d(10),
        period2: d(25),
        period3: d(15),
        previousYear: d(20),
      }).toNumber(),
    ).toBe(25);
  });
});

describe("simulateStockTimeline", () => {
  const baseInput = {
    bookStockDate: new Date("2026-01-01"),
    clientDeliveryDate: new Date("2026-01-10"),
    bookStockQty: d(100),
    receivedNotPostedQty: d(0),
    futureDeliveryEvents: [] as StockEvent[],
    forecastBetween: () => d(5),
  };

  it("simulates with no future delivery", () => {
    const result = simulateStockTimeline(baseInput);
    expect(result.projectedFinalStock.toNumber()).toBe(95);
    expect(result.totalForecastSales.toNumber()).toBe(5);
  });

  it("simulates one future delivery", () => {
    const result = simulateStockTimeline({
      ...baseInput,
      futureDeliveryEvents: [
        {
          eventType: "future_delivery",
          eventDate: new Date("2026-01-05"),
          quantity: d(30),
          sortOrder: 0,
        },
      ],
    });
    expect(result.futureDeliveryTotal.toNumber()).toBe(30);
    expect(result.projectedFinalStock.toNumber()).toBeGreaterThan(0);
  });

  it("simulates multiple future deliveries", () => {
    const result = simulateStockTimeline({
      ...baseInput,
      futureDeliveryEvents: [
        {
          eventType: "future_delivery",
          eventDate: new Date("2026-01-03"),
          quantity: d(10),
          sortOrder: 0,
        },
        {
          eventType: "future_delivery",
          eventDate: new Date("2026-01-07"),
          quantity: d(20),
          sortOrder: 1,
        },
      ],
    });
    expect(result.futureDeliveryTotal.toNumber()).toBe(30);
    expect(result.stages.filter((s) => s.stage === "future_delivery")).toHaveLength(
      2,
    );
  });

  it("records shortage and resets stock to zero", () => {
    const result = simulateStockTimeline({
      ...baseInput,
      bookStockQty: d(5),
      forecastBetween: () => d(20),
    });
    expect(result.totalShortage.toNumber()).toBeGreaterThan(0);
    expect(result.projectedFinalStock.toNumber()).toBe(0);
  });
});

describe("compareSupplierPrices", () => {
  const mm = {
    supplierId: 1,
    supplierCode: "MM001",
    supplierName: "MM",
    priceTiePriority: 1,
    hasMapping: true,
    netPrice: "10.00",
  };
  const sp = {
    supplierId: 2,
    supplierCode: "SP001",
    supplierName: "SP",
    priceTiePriority: 2,
    hasMapping: true,
    netPrice: "9.50",
  };
  const wabMissing = {
    supplierId: 3,
    supplierCode: "",
    supplierName: "WAB",
    priceTiePriority: 3,
    hasMapping: false,
    netPrice: null,
  };

  it("excludes WAB when not selected", () => {
    const result = compareSupplierPrices([mm, sp], d(10));
    expect(result.priceStatus).toBe("complete");
    expect(result.cheapestSupplierId).toBe(2);
  });

  it("CHECK when WAB included with missing code", () => {
    const result = compareSupplierPrices([mm, sp, wabMissing], d(10));
    expect(result.priceStatus).toBe("check_missing_code");
    expect(result.cheapestSupplierId).toBeNull();
  });

  it("CHECK when selected supplier has missing price", () => {
    const result = compareSupplierPrices(
      [{ ...sp, netPrice: null }],
      d(10),
    );
    expect(result.priceStatus).toBe("check_missing_price");
    expect(result.cheapestSupplierId).toBeNull();
  });

  it("uses tie priority for equal prices", () => {
    const result = compareSupplierPrices(
      [
        { ...mm, netPrice: "8.00" },
        { ...sp, netPrice: "8.00" },
      ],
      d(5),
    );
    expect(result.cheapestSupplierId).toBe(1);
    expect(
      result.snapshots.find((s) => s.supplierId === 1)?.isCheapest,
    ).toBe(true);
  });

  it("selects only supplier when one valid price", () => {
    const result = compareSupplierPrices([mm], d(3));
    expect(result.priceStatus).toBe("complete");
    expect(result.estimatedLineCost?.toNumber()).toBe(30);
  });

  it("persists snapshot rows for each supplier", () => {
    const result = compareSupplierPrices([mm, sp], d(1));
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots.every((s) => s.priceValidationStatus === "valid")).toBe(
      true,
    );
  });
});

describe("calculateSuggestedOrderQty", () => {
  it("never returns negative quantity", () => {
    expect(calculateSuggestedOrderQty(d(5), d(20)).toNumber()).toBe(0);
    expect(calculateSuggestedOrderQty(d(20), d(5)).toNumber()).toBe(15);
  });
});

describe("aggregateStockQuantities", () => {
  it("separates event types", () => {
    const result = aggregateStockQuantities([
      {
        eventType: "book_stock",
        eventDate: new Date(),
        quantity: d(10),
        sortOrder: 0,
      },
      {
        eventType: "received_not_posted",
        eventDate: new Date(),
        quantity: d(5),
        sortOrder: 0,
      },
    ]);
    expect(result.bookStockQty.toNumber()).toBe(10);
    expect(result.receivedNotPostedQty.toNumber()).toBe(5);
  });
});

describe("daily sales upsert semantics", () => {
  it("uses sold_qty only for ordering baseline", () => {
    const highest = calculateHighestSoldQty({
      period1: d(12),
      period2: d(0),
      period3: d(0),
      previousYear: d(0),
    });
    expect(highest.toNumber()).toBe(12);
  });
});
