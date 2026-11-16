import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { admShopCatalogs, products, storeProducts, supplierProducts, suppliers } from "@/db/schema";
import type { AdmCatalogItem } from "./types";

export async function getAdmCatalog(storeId: number): Promise<{ items: AdmCatalogItem[]; previousDate: string | null }> {
  const [saved] = await db.select().from(admShopCatalogs).where(eq(admShopCatalogs.storeId, storeId));
  if (saved) return saved;

  const rows = await db.select({ name: products.name, code: storeProducts.storeProductCode })
    .from(storeProducts)
    .innerJoin(products, eq(products.id, storeProducts.productId))
    .innerJoin(supplierProducts, eq(supplierProducts.productId, products.id))
    .innerJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
    .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.isActive, true),
      eq(products.isActive, true), eq(supplierProducts.isActive, true), eq(suppliers.isActive, true),
      sql`upper(${suppliers.code}) = 'ADM'`))
    .orderBy(asc(products.name), asc(storeProducts.storeProductCode));

  const counts = new Map<string, number>();
  for (const { name } of rows) counts.set(name, (counts.get(name) ?? 0) + 1);
  return {
    previousDate: null,
    items: rows.map(({ name, code }) => ({
      name: counts.get(name) === 1 ? name : `${name} (${code})`,
      code,
      barcode: null,
      salesUnit: null,
      previousQty: null,
    })),
  };
}
