import { describe, expect, it } from "vitest";
import { isIsoDateString } from "@/utils/iso-date";

describe("iso-date", () => {
  it("accepts YYYY-MM-DD strings", () => {
    expect(isIsoDateString("2026-10-14")).toBe(true);
  });

  it("rejects timestamps and invalid shapes", () => {
    expect(isIsoDateString("2026-10-14T00:00:00Z")).toBe(false);
    expect(isIsoDateString("14-10-2026")).toBe(false);
    expect(isIsoDateString(null)).toBe(false);
  });
});
