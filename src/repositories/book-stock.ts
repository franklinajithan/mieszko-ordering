import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookStockImports, bookStockItems } from "@/db/schema";

export const bookStockRepository = {
  async createImport(data: typeof bookStockImports.$inferInsert) {
    const [row] = await db.insert(bookStockImports).values(data).returning();
    return row;
  },

  async insertItems(rows: Array<typeof bookStockItems.$inferInsert>) {
    if (!rows.length) return [];
    return db.insert(bookStockItems).values(rows).returning();
  },

  async getImportById(importId: number) {
    const [row] = await db
      .select()
      .from(bookStockImports)
      .where(eq(bookStockImports.id, importId));
    return row ?? null;
  },

  async getLatestForStore(storeId: number) {
    const [row] = await db
      .select()
      .from(bookStockImports)
      .where(eq(bookStockImports.storeId, storeId))
      .orderBy(desc(bookStockImports.importedAt))
      .limit(1);
    return row ?? null;
  },

  async listForStore(storeId: number, limit = 50) {
    return db
      .select()
      .from(bookStockImports)
      .where(eq(bookStockImports.storeId, storeId))
      .orderBy(desc(bookStockImports.importedAt))
      .limit(limit);
  },

  async getItems(importId: number) {
    return db
      .select()
      .from(bookStockItems)
      .where(eq(bookStockItems.importId, importId));
  },

  async countItems(importId: number) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookStockItems)
      .where(eq(bookStockItems.importId, importId));
    return row?.count ?? 0;
  },
};
