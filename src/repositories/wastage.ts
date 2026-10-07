import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { storeProducts, wastage } from "@/db/schema";
import { BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE } from "@/lib/import-config";

export const wastageRepository = {
  async upsert(data: typeof wastage.$inferInsert) {
    const [row] = await db
      .insert(wastage)
      .values(data)
      .onConflictDoUpdate({
        target: [wastage.storeProductId, wastage.wastageDate],
        set: {
          wastageQty: data.wastageQty,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  async upsertBatch(data: Array<typeof wastage.$inferInsert>) {
    if (!data.length) return [];
    return db
      .insert(wastage)
      .values(data)
      .onConflictDoUpdate({
        target: [wastage.storeProductId, wastage.wastageDate],
        set: {
          wastageQty: sql`excluded.wastage_qty`,
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
        total: sql<string>`coalesce(sum(${wastage.wastageQty}), 0)`,
      })
      .from(wastage)
      .where(
        and(
          eq(wastage.storeProductId, storeProductId),
          gte(wastage.wastageDate, startDate),
          lte(wastage.wastageDate, endDate),
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
      wastageDate: string;
      wastageQty: string;
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
            storeProductId: wastage.storeProductId,
            wastageDate: wastage.wastageDate,
            wastageQty: wastage.wastageQty,
          })
          .from(wastage)
          .where(
            and(
              inArray(wastage.storeProductId, batch),
              gte(wastage.wastageDate, startDate),
              lte(wastage.wastageDate, endDate),
            ),
          )),
      );
    }
    return rows;
  },

  async deleteForStoreAndDate(storeId: number, wastageDate: string) {
    const productIds = await db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(eq(storeProducts.storeId, storeId));

    const ids = productIds.map((row) => row.id);
    if (!ids.length) return;

    await db
      .delete(wastage)
      .where(
        and(
          eq(wastage.wastageDate, wastageDate),
          inArray(wastage.storeProductId, ids),
        ),
      );
  },

  async listDateSummariesForStore(storeId: number) {
    return db
      .select({
        wastageDate: wastage.wastageDate,
        itemCount: sql<number>`count(*)::int`,
        totalWastageQty: sql<string>`coalesce(sum(${wastage.wastageQty}), 0)::text`,
        lastUpdated: sql<string>`max(${wastage.updatedAt})::text`,
      })
      .from(wastage)
      .innerJoin(storeProducts, eq(storeProducts.id, wastage.storeProductId))
      .where(eq(storeProducts.storeId, storeId))
      .groupBy(wastage.wastageDate)
      .orderBy(desc(wastage.wastageDate));
  },
};
