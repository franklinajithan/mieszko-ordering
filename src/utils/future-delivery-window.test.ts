import { describe, expect, it } from "vitest";

function futureDeliveryInOrderWindow(
  expectedDeliveryDate: string,
  bookStockDate: string,
  clientDeliveryDate: string,
): boolean {
  return (
    expectedDeliveryDate > bookStockDate &&
    expectedDeliveryDate <= clientDeliveryDate
  );
}

describe("future delivery order window", () => {
  it("includes arrivals after the snapshot through the client delivery date", () => {
    expect(
      futureDeliveryInOrderWindow("2026-10-15", "2026-10-14", "2026-10-20"),
    ).toBe(true);
    expect(
      futureDeliveryInOrderWindow("2026-10-20", "2026-10-14", "2026-10-20"),
    ).toBe(true);
  });

  it("excludes same-day snapshot and post-delivery arrivals", () => {
    expect(
      futureDeliveryInOrderWindow("2026-10-14", "2026-10-14", "2026-10-20"),
    ).toBe(false);
    expect(
      futureDeliveryInOrderWindow("2026-10-21", "2026-10-14", "2026-10-20"),
    ).toBe(false);
  });
});
