import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { rtcImports, rtcSales } from "@/db/schema";

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
};

export const rtcRepository = {
  async createImport(data: typeof rtcImports.$inferInsert) {
    const [row] = await db.insert(rtcImports).values(data).returning();
    return row;
  },

  async updateMatchedRows(importId: number, matchedRows: number) {
    const [row] = await db
      .update(rtcImports)
      .set({ matchedRows })
      .where(eq(rtcImports.id, importId))
      .returning();
    return row ?? null;
  },

  async getImportById(importId: number) {
    const [row] = await db
      .select()
      .from(rtcImports)
      .where(eq(rtcImports.id, importId));
    return row ?? null;
  },

  async listForStore(storeId: number, limit = 50) {
    return db
      .select()
      .from(rtcImports)
      .where(eq(rtcImports.storeId, storeId))
      .orderBy(desc(rtcImports.importedAt))
      .limit(limit);
  },
};
