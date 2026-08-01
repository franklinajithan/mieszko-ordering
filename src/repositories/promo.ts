import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { promoImports, promoSales } from "@/db/schema";

export const promoSalesRepository = {
  async upsert(data: typeof promoSales.$inferInsert) {
    const [row] = await db
      .insert(promoSales)
      .values(data)
      .onConflictDoUpdate({
        target: [promoSales.storeProductId, promoSales.promoDate],
        set: {
          promoQty: data.promoQty,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  async sumInPeriod(
    storeProductId: number,
    startDate: string,
    endDate: string,
  ) {
    const [row] = await db
      .select({
        total: sql<string>`coalesce(sum(${promoSales.promoQty}), 0)`,
      })
      .from(promoSales)
      .where(
        and(
          eq(promoSales.storeProductId, storeProductId),
          gte(promoSales.promoDate, startDate),
          lte(promoSales.promoDate, endDate),
        ),
      );
    return row?.total ?? "0";
  },
};

export const promoRepository = {
  async createImport(data: typeof promoImports.$inferInsert) {
    const [row] = await db.insert(promoImports).values(data).returning();
    return row;
  },

  async updateMatchedRows(importId: number, matchedRows: number) {
    const [row] = await db
      .update(promoImports)
      .set({ matchedRows })
      .where(eq(promoImports.id, importId))
      .returning();
    return row ?? null;
  },

  async getImportById(importId: number) {
    const [row] = await db
      .select()
      .from(promoImports)
      .where(eq(promoImports.id, importId));
    return row ?? null;
  },

  async listForStore(storeId: number, limit = 50) {
    return db
      .select()
      .from(promoImports)
      .where(eq(promoImports.storeId, storeId))
      .orderBy(desc(promoImports.importedAt))
      .limit(limit);
  },
};
