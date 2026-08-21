import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailySales, storeProducts } from "@/db/schema";

export const dailySalesRepository = {
  async upsertSale(data: typeof dailySales.$inferInsert) {
    const [row] = await db
      .insert(dailySales)
      .values(data)
      .onConflictDoUpdate({
        target: [dailySales.storeProductId, dailySales.salesDate],
        set: {
          soldQty: data.soldQty,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  async upsertSalesBatch(data: Array<typeof dailySales.$inferInsert>) {
    if (!data.length) return [];
    return db
      .insert(dailySales)
      .values(data)
      .onConflictDoUpdate({
        target: [dailySales.storeProductId, dailySales.salesDate],
        set: {
          soldQty: sql`excluded.sold_qty`,
          updatedAt: new Date(),
        },
      })
      .returning();
  },

  async sumSalesInPeriod(
    storeProductId: number,
    startDate: string,
    endDate: string,
  ) {
    const [row] = await db
      .select({
        total: sql<string>`coalesce(sum(${dailySales.soldQty}), 0)`,
      })
      .from(dailySales)
      .where(
        and(
          eq(dailySales.storeProductId, storeProductId),
          gte(dailySales.salesDate, startDate),
          lte(dailySales.salesDate, endDate),
        ),
      );
    return row?.total ?? "0";
  },

  async getSalesForProduct(storeProductId: number) {
    return db
      .select()
      .from(dailySales)
      .where(eq(dailySales.storeProductId, storeProductId))
      .orderBy(dailySales.salesDate);
  },

  async getSalesByProductsInRange(
    storeProductIds: number[],
    startDate: string,
    endDate: string,
  ) {
    if (!storeProductIds.length) return [];
    return db
      .select({
        storeProductId: dailySales.storeProductId,
        salesDate: dailySales.salesDate,
        soldQty: dailySales.soldQty,
      })
      .from(dailySales)
      .where(
        and(
          inArray(dailySales.storeProductId, storeProductIds),
          gte(dailySales.salesDate, startDate),
          lte(dailySales.salesDate, endDate),
        ),
      );
  },

  async deleteForStoreAndDate(storeId: number, salesDate: string) {
    const productIds = await db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(eq(storeProducts.storeId, storeId));

    const ids = productIds.map((row) => row.id);
    if (!ids.length) return;

    await db
      .delete(dailySales)
      .where(
        and(eq(dailySales.salesDate, salesDate), inArray(dailySales.storeProductId, ids)),
      );
  },

  async listDateSummariesForStore(
    storeId: number,
    { limit, offset }: { limit: number; offset: number },
  ) {
    const where = eq(storeProducts.storeId, storeId);
    const [summaryRows, totalRows] = await Promise.all([
      db
      .select({
        salesDate: dailySales.salesDate,
        itemCount: sql<number>`count(*)::int`,
        totalSoldQty: sql<string>`coalesce(sum(${dailySales.soldQty}), 0)::text`,
        lastUpdated: sql<string>`max(${dailySales.updatedAt})::text`,
      })
      .from(dailySales)
      .innerJoin(storeProducts, eq(storeProducts.id, dailySales.storeProductId))
      .where(where)
      .groupBy(dailySales.salesDate)
      .orderBy(desc(dailySales.salesDate))
      .limit(limit)
      .offset(offset),
      db
        .select({
          total: sql<number>`count(distinct ${dailySales.salesDate})::int`,
        })
        .from(dailySales)
        .innerJoin(storeProducts, eq(storeProducts.id, dailySales.storeProductId))
        .where(where),
    ]);

    return {
      rows: summaryRows,
      total: totalRows[0]?.total ?? 0,
    };
  },

  async listDateSummariesForStoresInRange(
    storeIds: number[],
    startDate: string,
    endDate: string,
  ) {
    if (!storeIds.length) return [];
    return db
      .select({
        storeId: storeProducts.storeId,
        salesDate: dailySales.salesDate,
        itemCount: sql<number>`count(*)::int`,
        totalSoldQty: sql<string>`coalesce(sum(${dailySales.soldQty}), 0)::text`,
        lastUpdated: sql<string>`max(${dailySales.updatedAt})::text`,
      })
      .from(dailySales)
      .innerJoin(storeProducts, eq(storeProducts.id, dailySales.storeProductId))
      .where(
        and(
          inArray(storeProducts.storeId, storeIds),
          gte(dailySales.salesDate, startDate),
          lte(dailySales.salesDate, endDate),
        ),
      )
      .groupBy(storeProducts.storeId, dailySales.salesDate)
      .orderBy(dailySales.salesDate, storeProducts.storeId);
  },
};
