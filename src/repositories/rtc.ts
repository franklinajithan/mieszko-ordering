import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { rtcSales, storeProducts } from "@/db/schema";
import { BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE } from "@/lib/import-config";

export const rtcSalesRepository = {
  async upsert(data: typeof rtcSales.$inferInsert) {
    const [row] = await db
      .insert(rtcSales)
      .values(data)
      .onConflictDoUpdate({
        target: [rtcSales.storeProductId, rtcSales.rtcDate],
        set: {
          rtcQty: data.rtcQty,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  async upsertBatch(data: Array<typeof rtcSales.$inferInsert>) {
    if (!data.length) return [];
    return db
      .insert(rtcSales)
      .values(data)
      .onConflictDoUpdate({
        target: [rtcSales.storeProductId, rtcSales.rtcDate],
        set: {
          rtcQty: sql`excluded.rtc_qty`,
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
        total: sql<string>`coalesce(sum(${rtcSales.rtcQty}), 0)`,
      })
      .from(rtcSales)
      .where(
        and(
          eq(rtcSales.storeProductId, storeProductId),
          gte(rtcSales.rtcDate, startDate),
          lte(rtcSales.rtcDate, endDate),
        ),
      );
    return row?.total ?? "0";
  },

  async getByProductsInRange(
    storeProductIds: number[],
    startDate: string,
    endDate: string,
  ) {
    const uniqueIds = [...new Set(storeProductIds)];
    if (!uniqueIds.length) return [];
    const rows: Array<{
      storeProductId: number;
      rtcDate: string;
      rtcQty: string;
    }> = [];
    for (
      let index = 0;
      index < uniqueIds.length;
      index += BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE
    ) {
      const batch = uniqueIds.slice(index, index + BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE);
      if (!batch.length) continue;
      rows.push(
        ...(await db
          .select({
            storeProductId: rtcSales.storeProductId,
            rtcDate: rtcSales.rtcDate,
            rtcQty: rtcSales.rtcQty,
          })
          .from(rtcSales)
          .where(
            and(
              inArray(rtcSales.storeProductId, batch),
              gte(rtcSales.rtcDate, startDate),
              lte(rtcSales.rtcDate, endDate),
            ),
          )),
      );
    }
    return rows;
  },

  async deleteForStoreAndDate(storeId: number, rtcDate: string) {
    const productIds = await db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(eq(storeProducts.storeId, storeId));

    const ids = productIds.map((row) => row.id);
    if (!ids.length) return;

    await db
      .delete(rtcSales)
      .where(and(eq(rtcSales.rtcDate, rtcDate), inArray(rtcSales.storeProductId, ids)));
  },

  async listDateSummariesForStore(storeId: number) {
    return db
      .select({
        rtcDate: rtcSales.rtcDate,
        itemCount: sql<number>`count(*)::int`,
        totalRtcQty: sql<string>`coalesce(sum(${rtcSales.rtcQty}), 0)::text`,
        lastUpdated: sql<string>`max(${rtcSales.updatedAt})::text`,
      })
      .from(rtcSales)
      .innerJoin(storeProducts, eq(storeProducts.id, rtcSales.storeProductId))
      .where(eq(storeProducts.storeId, storeId))
      .groupBy(rtcSales.rtcDate)
      .orderBy(desc(rtcSales.rtcDate));
  },
};
