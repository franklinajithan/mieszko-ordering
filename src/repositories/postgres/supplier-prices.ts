import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { supplierPriceImports, supplierPrices, supplierProducts } from "@/db/schema";

export const supplierPriceRepository = {
  async createImport(data: typeof supplierPriceImports.$inferInsert) {
    const [row] = await db
      .insert(supplierPriceImports)
      .values(data)
      .returning();
    return row;
  },

  async insertPrices(rows: Array<typeof supplierPrices.$inferInsert>) {
    if (!rows.length) return [];
    return db.insert(supplierPrices).values(rows).returning();
  },

  async getLatestPrice(supplierProductId: number, asOfDate: string) {
    const [row] = await db
      .select()
      .from(supplierPrices)
      .where(
        and(
          eq(supplierPrices.supplierProductId, supplierProductId),
          lte(supplierPrices.effectiveDate, asOfDate),
        ),
      )
      .orderBy(desc(supplierPrices.effectiveDate), desc(supplierPrices.createdAt))
      .limit(1);
    return row ?? null;
  },

  async findSupplierProduct(supplierId: number, supplierCode: string) {
    const [row] = await db
      .select()
      .from(supplierProducts)
      .where(
        and(
          eq(supplierProducts.supplierId, supplierId),
          eq(supplierProducts.supplierCode, supplierCode),
        ),
      );
    return row ?? null;
  },
};
