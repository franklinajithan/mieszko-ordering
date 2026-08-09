import { normalizeProductCode } from "@/parsers/products/product-file-parser";

export type StoreProductRef = { id: number; storeProductCode: string };

export function catalogCodeKey(code: string): string {
  return normalizeProductCode(code).toLowerCase();
}

/** Index store products by exact code and normalized lowercase key. */
export function indexStoreProducts(
  products: StoreProductRef[],
): Map<string, StoreProductRef> {
  const map = new Map<string, StoreProductRef>();
  for (const product of products) {
    map.set(product.storeProductCode, product);
    map.set(catalogCodeKey(product.storeProductCode), product);
  }
  return map;
}

export function resolveStoreProduct(
  map: Map<string, StoreProductRef>,
  reference: string,
): StoreProductRef | undefined {
  const normalized = normalizeProductCode(reference);
  if (!normalized) return undefined;
  return map.get(normalized) ?? map.get(catalogCodeKey(normalized));
}
