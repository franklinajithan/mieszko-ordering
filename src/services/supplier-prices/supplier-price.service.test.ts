import { describe, expect, it } from "vitest";
import { Decimal } from "@/utils/decimal";
import { compareSupplierPrices, type SupplierPriceInput } from "@/services/supplier-prices/supplier-price.service";

function quote(id: number, netPrice: string | null, caseSize: string | null): SupplierPriceInput {
  return {
    supplierId: id,
    supplierKey: String(id),
    supplierCode: "SKU-" + id,
    supplierName: "Supplier " + id,
    priceTiePriority: id,
    hasMapping: true,
    netPrice,
    caseSize,
  };
}

describe("supplier unit-price selection", () => {
  it("always selects the lowest valid unit price regardless of case size", () => {
    const result = compareSupplierPrices(
      [quote(1, "1.00", "24"), quote(2, "1.10", "6")],
      new Decimal(15),
    );
    expect(result.cheapestSupplierId).toBe(1);
    expect(result.cheapestNetPrice?.toString()).toBe("1");
    expect(result.estimatedLineCost?.toString()).toBe("15");
  });

  it("still selects a valid quote if another supplier has no price", () => {
    const result = compareSupplierPrices(
      [quote(1, null, "12"), quote(2, "2.50", "6")],
      new Decimal(8),
    );
    expect(result.cheapestSupplierId).toBe(2);
    expect(result.warning).toContain("missing net price");
  });

  it("returns a missing-price result when no supplier has a valid quote", () => {
    const result = compareSupplierPrices([quote(1, null, "12")], new Decimal(5));
    expect(result.cheapestSupplierId).toBeNull();
    expect(result.priceStatus).toBe("check_missing_price");
  });
});
