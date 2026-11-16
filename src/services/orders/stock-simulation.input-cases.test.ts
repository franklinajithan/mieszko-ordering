import { describe, expect, it } from "vitest";
import { Decimal } from "@/utils/decimal";
import { simulateStockTimeline, type StockEvent } from "@/services/orders/stock-simulation.service";

const date = (day: string) => new Date(day + "T00:00:00Z");
const delivery = (day: string, qty: number, sortOrder = 0): StockEvent => ({
  eventType: "future_delivery",
  eventDate: date(day),
  quantity: new Decimal(qty),
  sortOrder,
});
const simulate = (opening: number, incoming: number, events: StockEvent[], daily: number) =>
  simulateStockTimeline({
    bookStockDate: date("2026-10-01"),
    clientDeliveryDate: date("2026-10-05"),
    bookStockQty: new Decimal(opening),
    receivedNotPostedQty: new Decimal(incoming),
    futureDeliveryEvents: events,
    forecastBetween: (from, to) =>
      new Decimal((to.getTime() - from.getTime()) / 86400000).mul(daily),
  });

describe("Generate Order stock simulation input cases", () => {
  it("projects stock with no incoming deliveries", () => {
    const result = simulate(20, 0, [], 2);
    expect(result.projectedFinalStock.toString()).toBe("12");
    expect(result.totalForecastSales.toString()).toBe("8");
  });

  it("adds received-but-not-posted stock to opening stock", () => {
    expect(simulate(20, 5, [], 2).projectedFinalStock.toString()).toBe("17");
  });

  it("adds multiple future deliveries in chronological order", () => {
    const result = simulate(20, 0, [
      delivery("2026-10-04", 4),
      delivery("2026-10-02", 6),
    ], 2);
    expect(result.projectedFinalStock.toString()).toBe("22");
    expect(result.futureDeliveryTotal.toString()).toBe("10");
  });

  it("does not count deliveries before the stock snapshot or after the order date", () => {
    const result = simulate(20, 0, [
      delivery("2026-09-30", 100),
      delivery("2026-10-06", 100),
    ], 2);
    expect(result.projectedFinalStock.toString()).toBe("12");
    expect(result.futureDeliveryTotal.toString()).toBe("0");
  });

  it("records a shortage instead of allowing negative physical stock", () => {
    const result = simulate(2, 0, [], 3);
    expect(result.projectedFinalStock.toString()).toBe("0");
    expect(result.totalShortage.toString()).toBe("10");
  });

  it("does not count deliveries on the opening snapshot date twice", () => {
    const result = simulate(20, 0, [delivery("2026-10-01", 7)], 2);
    expect(result.projectedFinalStock.toString()).toBe("12");
    expect(result.futureDeliveryTotal.toString()).toBe("0");
  });
});
