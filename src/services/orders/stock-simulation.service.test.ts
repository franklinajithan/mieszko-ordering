import { describe, expect, it } from "vitest";
import { Decimal } from "@/utils/decimal";
import { simulateStockTimeline, type StockEvent } from "./stock-simulation.service";

const date = (value: string) => new Date(value + "T00:00:00Z");
const delivery = (day: string, quantity: number): StockEvent => ({
  eventType: "future_delivery",
  eventDate: date(day),
  quantity: new Decimal(quantity),
  sortOrder: 0,
});

describe("stock timeline", () => {
  const base = {
    bookStockDate: date("2026-10-14"),
    clientDeliveryDate: date("2026-10-20"),
    bookStockQty: new Decimal(20),
    receivedNotPostedQty: new Decimal(5),
    forecastBetween: () => new Decimal(0),
  };

  it("includes deliveries arriving by the target date", () => {
    const result = simulateStockTimeline({
      ...base,
      futureDeliveryEvents: [delivery("2026-10-18", 12)],
    });
    expect(result.projectedFinalStock.toString()).toBe("37");
    expect(result.futureDeliveryTotal.toString()).toBe("12");
    expect(result.stages.map((stage) => stage.stage)).toEqual([
      "opening", "future_delivery", "to_client_delivery",
    ]);
  });

  it("ignores deliveries after the target date", () => {
    const result = simulateStockTimeline({
      ...base,
      futureDeliveryEvents: [delivery("2026-10-21", 12)],
    });
    expect(result.projectedFinalStock.toString()).toBe("25");
    expect(result.futureDeliveryTotal.toString()).toBe("0");
  });

  it("does not count shortages as negative on-hand stock", () => {
    const result = simulateStockTimeline({
      ...base,
      bookStockQty: new Decimal(3),
      receivedNotPostedQty: new Decimal(0),
      futureDeliveryEvents: [delivery("2026-10-18", 4)],
      forecastBetween: () => new Decimal(5),
    });
    expect(result.totalShortage.toString()).toBe("7");
    expect(result.projectedFinalStock.toString()).toBe("0");
  });

  it("applies multiple deliveries in date order", () => {
    const result = simulateStockTimeline({
      ...base,
      futureDeliveryEvents: [
        delivery("2026-10-19", 8),
        delivery("2026-10-16", 4),
      ],
    });
    expect(result.projectedFinalStock.toString()).toBe("37");
    expect(result.stages[1]?.eventDate).toBe("2026-10-16");
    expect(result.stages[2]?.eventDate).toBe("2026-10-19");
  });
});
