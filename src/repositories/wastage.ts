import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { storeProducts, storeWastage, wastageImports } from "@/db/schema";

export const storeWastageRepository = {
  async upsert(data: typeof storeWastage.$inferInsert) {
    const [row] = await db
      .insert(storeWastage)
      .values(data)
      .onConflictDoUpdate({
        target: [storeWastage.storeProductId, storeWastage.wastageDate],
        set: {
          wastageQty: data.wastageQty,
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
        total: sql<string>`coalesce(sum(${storeWastage.wastageQty}), 0)`,
      })
      .from(storeWastage)
      .where(
        and(
          eq(storeWastage.storeProductId, storeProductId),
          gte(storeWastage.wastageDate, startDate),
          lte(storeWastage.wastageDate, endDate),
        ),
      );
    return row?.total ?? "0";
  },

  async deleteForStoreAndDate(storeId: number, wastageDate: string) {
    const productIds = await db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(eq(storeProducts.storeId, storeId));

    const ids = productIds.map((row) => row.id);
    if (!ids.length) return;

    await db
      .delete(storeWastage)
      .where(
        and(eq(storeWastage.wastageDate, wastageDate), inArray(storeWastage.storeProductId, ids)),
      );
  },

  async listDateSummariesForStore(storeId: number) {
    return db
      .select({
        wastageDate: storeWastage.wastageDate,
        itemCount: sql<number>`count(*)::int`,
        totalWastageQty: sql<string>`coalesce(sum(${storeWastage.wastageQty}), 0)::text`,
        lastUpdated: sql<string>`max(${storeWastage.updatedAt})::text`,
      })
      .from(storeWastage)
      .innerJoin(storeProducts, eq(storeProducts.id, storeWastage.storeProductId))
      .where(eq(storeProducts.storeId, storeId))
      .groupBy(storeWastage.wastageDate)
      .orderBy(desc(storeWastage.wastageDate));
  },
};

export const wastageRepository = {
  async createImport(data: typeof wastageImports.$inferInsert) {
    const [row] = await db.insert(wastageImports).values(data).returning();
    return row;
  },

  async updateMatchedRows(importId: number, matchedRows: number) {
    const [row] = await db
      .update(wastageImports)
      .set({ matchedRows })
      .where(eq(wastageImports.id, importId))
      .returning();
    return row ?? null;
  },

  async getImportById(importId: number) {
    const [row] = await db
      .select()
      .from(wastageImports)
      .where(eq(wastageImports.id, importId));
    return row ?? null;
  },

  async listForStore(storeId: number, limit = 50) {
    return db
      .select()
      .from(wastageImports)
      .where(eq(wastageImports.storeId, storeId))
      .orderBy(desc(wastageImports.importedAt))
      .limit(limit);
  },
};
