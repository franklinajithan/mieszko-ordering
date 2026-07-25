import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailySales } from "@/db/schema";

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
};
