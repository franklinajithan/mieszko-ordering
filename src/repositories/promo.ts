import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { promoSales, storeProducts } from "@/db/schema";

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

  async upsertBatch(data: Array<typeof promoSales.$inferInsert>) {
    if (!data.length) return [];
    return db
      .insert(promoSales)
      .values(data)
      .onConflictDoUpdate({
        target: [promoSales.storeProductId, promoSales.promoDate],
        set: {
          promoQty: sql`excluded.promo_qty`,
          updatedAt: new Date(),
        },
      })
      .returning();
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

  async deleteForStoreAndDate(storeId: number, promoDate: string) {
    const productIds = await db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(eq(storeProducts.storeId, storeId));

    const ids = productIds.map((row) => row.id);
    if (!ids.length) return;

    await db
      .delete(promoSales)
      .where(
        and(
          eq(promoSales.promoDate, promoDate),
          inArray(promoSales.storeProductId, ids),
        ),
      );
  },

  async listDateSummariesForStore(storeId: number) {
    return db
      .select({
        promoDate: promoSales.promoDate,
        itemCount: sql<number>`count(*)::int`,
        totalPromoQty: sql<string>`coalesce(sum(${promoSales.promoQty}), 0)::text`,
        lastUpdated: sql<string>`max(${promoSales.updatedAt})::text`,
      })
      .from(promoSales)
      .innerJoin(storeProducts, eq(storeProducts.id, promoSales.storeProductId))
      .where(eq(storeProducts.storeId, storeId))
      .groupBy(promoSales.promoDate)
      .orderBy(desc(promoSales.promoDate));
  },
};
