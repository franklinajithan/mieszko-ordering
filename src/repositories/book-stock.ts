import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE } from "@/lib/import-config";
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
    const ids = await storeProductIds(storeId);
    if (!ids.length) return null;

    const [row] = await db
      .select({ importedAt: bookStock.importedAt })
      .from(bookStock)
      .where(inArray(bookStock.storeProductId, ids))
      .orderBy(desc(bookStock.importedAt))
      .limit(1);

    return row?.importedAt ?? null;
  },

  async hasImportedAt(storeId: number, importedAt: Date): Promise<boolean> {
    const ids = await storeProductIds(storeId);
    if (!ids.length) return false;
    const [row] = await db
      .select({ importedAt: bookStock.importedAt })
      .from(bookStock)
      .where(
        and(
          eq(bookStock.importedAt, importedAt),
          inArray(bookStock.storeProductId, ids),
        ),
      )
      .limit(1);
    return Boolean(row);
  },

  /** Latest upload timestamp for a store on a given business date. */
  async getLatestImportedAtForDate(
    storeId: number,
    bookStockDate: string,
  ): Promise<Date | null> {
    const ids = await storeProductIds(storeId);
    if (!ids.length) return null;

    const [row] = await db
      .select({ importedAt: bookStock.importedAt })
      .from(bookStock)
      .where(
        and(
          inArray(bookStock.storeProductId, ids),
          eq(bookStock.bookStockDate, bookStockDate),
        ),
      )
      .orderBy(desc(bookStock.importedAt))
      .limit(1);

    return row?.importedAt ?? null;
  },

  async listForStoreAndImportedAt(storeId: number, importedAt: Date) {
    const ids = await storeProductIds(storeId);
    if (!ids.length) return [];

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
          inArray(bookStock.storeProductId, ids),
          eq(bookStock.importedAt, importedAt),
        ),
      );
  },

  async latestQtyByStoreProductIds(storeProductIds: number[]) {
    const qtyByProduct = new Map<number, string>();
    const uniqueIds = [...new Set(storeProductIds)];

    for (
      let index = 0;
      index < uniqueIds.length;
      index += BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE
    ) {
      const batch = uniqueIds.slice(index, index + BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE);
      if (!batch.length) continue;

      const rows = await db
        .selectDistinctOn([bookStock.storeProductId], {
          storeProductId: bookStock.storeProductId,
          bookStockQty: bookStock.bookStockQty,
        })
        .from(bookStock)
        .where(inArray(bookStock.storeProductId, batch))
        .orderBy(bookStock.storeProductId, desc(bookStock.importedAt));

      for (const row of rows) {
        qtyByProduct.set(row.storeProductId, row.bookStockQty);
      }
    }

    return qtyByProduct;
  },

  /** Upload history: one row per import timestamp (newest first). */
  async listUploadSummariesForStore(storeId: number) {
    const ids = await storeProductIds(storeId);
    if (!ids.length) return [];

    const rows = await db
      .select({
        bookStockDate: bookStock.bookStockDate,
        importedAt: bookStock.importedAt,
        itemCount: sql<number>`count(*)::int`,
        totalBookStockQty: sql<string>`coalesce(sum(${bookStock.bookStockQty}), 0)::text`,
      })
      .from(bookStock)
      .where(inArray(bookStock.storeProductId, ids))
      .groupBy(bookStock.bookStockDate, bookStock.importedAt)
      .orderBy(desc(bookStock.importedAt));

    return rows.map((row) => ({
      bookStockDate: row.bookStockDate,
      importedAt: row.importedAt.toISOString(),
      itemCount: row.itemCount,
      totalBookStockQty: row.totalBookStockQty,
    }));
  },
};
