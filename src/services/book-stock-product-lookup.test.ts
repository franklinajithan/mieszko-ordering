import { describe, expect, it } from "vitest";
import {
  catalogCodeKey,
  indexStoreProducts,
  resolveStoreProduct,
} from "./book-stock-product-lookup";

describe("book-stock-product-lookup", () => {
  const products = [
    { id: 1, storeProductCode: "P60298" },
    { id: 2, storeProductCode: "10609310" },
  ];
  const map = indexStoreProducts(products);

  it("matches exact store product code", () => {
    expect(resolveStoreProduct(map, "P60298")?.id).toBe(1);
  });

  it("matches case-insensitive", () => {
    expect(resolveStoreProduct(map, "p60298")?.id).toBe(1);
  });

  it("normalizes spreadsheet numeric codes", () => {
    expect(resolveStoreProduct(map, "10609310.0")?.id).toBe(2);
  });

  it("uses catalogCodeKey consistently", () => {
    expect(catalogCodeKey("P60298")).toBe("p60298");
  });
});
