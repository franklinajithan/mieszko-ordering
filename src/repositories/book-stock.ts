import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookStock, storeProducts } from "@/db/schema";

async function storeProductIds(storeId: number) {
  const rows = await db
    .select({ id: storeProducts.id })
    .from(storeProducts)
    .where(eq(storeProducts.storeId, storeId));
  return rows.map((row) => row.id);
}

export const bookStockRepository = {
  async insertBatch(data: Array<typeof bookStock.$inferInsert>) {
    if (!data.length) return [];
    return db.insert(bookStock).values(data).returning();
  },

  async deleteForStoreAndImportedAt(storeId: number, importedAt: Date) {
    const ids = await storeProductIds(storeId);
    if (!ids.length) return;

    await db
      .delete(bookStock)
      .where(
        and(
          eq(bookStock.importedAt, importedAt),
          inArray(bookStock.storeProductId, ids),
        ),
      );
  },

  async getLatestImportedAt(storeId: number): Promise<Date | null> {
    const [row] = await db
      .select({ importedAt: bookStock.importedAt })
      .from(bookStock)
      .innerJoin(storeProducts, eq(storeProducts.id, bookStock.storeProductId))
      .where(eq(storeProducts.storeId, storeId))
      .orderBy(desc(bookStock.importedAt))
      .limit(1);

    return row?.importedAt ?? null;
  },

  /** Latest upload timestamp for a store on a given business date. */
  async getLatestImportedAtForDate(
    storeId: number,
    bookStockDate: string,
  ): Promise<Date | null> {
    const [row] = await db
      .select({ importedAt: bookStock.importedAt })
      .from(bookStock)
      .innerJoin(storeProducts, eq(storeProducts.id, bookStock.storeProductId))
      .where(
        and(
          eq(storeProducts.storeId, storeId),
          eq(bookStock.bookStockDate, bookStockDate),
        ),
      )
      .orderBy(desc(bookStock.importedAt))
      .limit(1);

    return row?.importedAt ?? null;
  },

  async listForStoreAndImportedAt(storeId: number, importedAt: Date) {
    return db
      .select({
        storeProductId: bookStock.storeProductId,
        bookStockQty: bookStock.bookStockQty,
        bookStockDate: bookStock.bookStockDate,
        storeProductCode: storeProducts.storeProductCode,
        importedAt: bookStock.importedAt,
      })
      .from(bookStock)
      .innerJoin(storeProducts, eq(storeProducts.id, bookStock.storeProductId))
      .where(
        and(
          eq(storeProducts.storeId, storeId),
          eq(bookStock.importedAt, importedAt),
        ),
      );
  },

  /** Upload history: one row per import timestamp (newest first). */
  async listUploadSummariesForStore(storeId: number) {
    return db
      .select({
        bookStockDate: bookStock.bookStockDate,
        importedAt: sql<string>`to_char(${bookStock.importedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        itemCount: sql<number>`count(*)::int`,
        totalBookStockQty: sql<string>`coalesce(sum(${bookStock.bookStockQty}), 0)::text`,
      })
      .from(bookStock)
      .innerJoin(storeProducts, eq(storeProducts.id, bookStock.storeProductId))
      .where(eq(storeProducts.storeId, storeId))
      .groupBy(bookStock.bookStockDate, bookStock.importedAt)
      .orderBy(desc(bookStock.importedAt));
  },
};
