import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE } from "@/lib/import-config";
import { futureDeliveries, storeProducts } from "@/db/schema";

async function storeProductIds(storeId: number) {
  const rows = await db
    .select({ id: storeProducts.id })
    .from(storeProducts)
    .where(eq(storeProducts.storeId, storeId));
  return rows.map((row) => row.id);
}

export const futureDeliveryRepository = {
  async insertBatch(data: Array<typeof futureDeliveries.$inferInsert>) {
    if (!data.length) return [];
    return db.insert(futureDeliveries).values(data).returning();
  },

  async deleteForStoreAndImportedAt(storeId: number, importedAt: Date) {
    const ids = await storeProductIds(storeId);
    if (!ids.length) return;
    await db
      .delete(futureDeliveries)
      .where(
        and(
          eq(futureDeliveries.importedAt, importedAt),
          inArray(futureDeliveries.storeProductId, ids),
        ),
      );
  },

  async sumQtyByStoreProductIds(storeProductIds: number[]) {
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
        .select({
          storeProductId: futureDeliveries.storeProductId,
          quantity: sql<string>`coalesce(sum(${futureDeliveries.quantity}), 0)::text`,
        })
        .from(futureDeliveries)
        .where(inArray(futureDeliveries.storeProductId, batch))
        .groupBy(futureDeliveries.storeProductId);

      for (const row of rows) {
        qtyByProduct.set(row.storeProductId, row.quantity);
      }
    }

    return qtyByProduct;
  },

  async storeSummary(storeId: number) {
    const ids = await storeProductIds(storeId);
    if (!ids.length) {
      return { fileCount: 0, itemCount: 0, totalQty: "0" };
    }
    const [row] = await db
      .select({
        fileCount: sql<number>`count(distinct ${futureDeliveries.importedAt})::int`,
        itemCount: sql<number>`count(distinct ${futureDeliveries.storeProductId})::int`,
        totalQty: sql<string>`coalesce(sum(${futureDeliveries.quantity}), 0)::text`,
      })
      .from(futureDeliveries)
      .where(inArray(futureDeliveries.storeProductId, ids));
    return {
      fileCount: row?.fileCount ?? 0,
      itemCount: row?.itemCount ?? 0,
      totalQty: row?.totalQty ?? "0",
    };
  },

  async listUploadsForStore(storeId: number) {
    const ids = await storeProductIds(storeId);
    if (!ids.length) return [];

    const rows = await db
      .select({
        fileName: futureDeliveries.fileName,
        source: futureDeliveries.source,
        importedAt: futureDeliveries.importedAt,
        itemCount: sql<number>`count(*)::int`,
        totalQty: sql<string>`coalesce(sum(${futureDeliveries.quantity}), 0)::text`,
      })
      .from(futureDeliveries)
      .where(inArray(futureDeliveries.storeProductId, ids))
      .groupBy(
        futureDeliveries.fileName,
        futureDeliveries.source,
        futureDeliveries.importedAt,
      )
      .orderBy(desc(futureDeliveries.importedAt));

    return rows.map((row) => ({
      fileName: row.fileName,
      source: row.source,
      importedAt: row.importedAt.toISOString(),
      itemCount: row.itemCount,
      totalQty: row.totalQty,
    }));
  },
};
