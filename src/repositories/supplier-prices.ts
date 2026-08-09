import "server-only";
import { and, count, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { supplierPrices, supplierProducts, suppliers } from "@/db/schema";

export type SupplierPriceUploadSummary = {
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  importedAt: string;
  effectiveDate: string;
  fileName: string | null;
  lineCount: number;
};

export const supplierPriceRepository = {
  async insertPrices(rows: Array<typeof supplierPrices.$inferInsert>) {
    if (!rows.length) return [];
    return db.insert(supplierPrices).values(rows).returning();
  },

  /**
   * Latest price for a supplier product (product-wise, not store-wise).
   * Prefer the most recent import timestamp, then createdAt.
   */
  async getLatestPrice(supplierProductId: number, asOfDate: string) {
    const [row] = await db
      .select()
      .from(supplierPrices)
      .where(
        and(
          eq(supplierPrices.supplierProductId, supplierProductId),
          lte(supplierPrices.effectiveDate, asOfDate),
        ),
      )
      .orderBy(desc(supplierPrices.importedAt), desc(supplierPrices.createdAt))
      .limit(1);
    return row ?? null;
  },

  async findSupplierProduct(supplierId: number, supplierCode: string) {
    const [row] = await db
      .select()
      .from(supplierProducts)
      .where(
        and(
          eq(supplierProducts.supplierId, supplierId),
          eq(supplierProducts.supplierCode, supplierCode),
        ),
      );
    return row ?? null;
  },

  async deleteForSupplierAndImportedAt(supplierId: number, importedAt: Date) {
    await db
      .delete(supplierPrices)
      .where(
        and(
          eq(supplierPrices.supplierId, supplierId),
          eq(supplierPrices.importedAt, importedAt),
        ),
      );
  },

  /** Upload batches: supplier + importedAt + line count. */
  async listUploadSummaries(): Promise<SupplierPriceUploadSummary[]> {
    const rows = await db
      .select({
        supplierId: supplierPrices.supplierId,
        supplierCode: suppliers.code,
        supplierName: suppliers.name,
        importedAt: sql<string>`to_char(${supplierPrices.importedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        effectiveDate: supplierPrices.effectiveDate,
        fileName: sql<string | null>`max(${supplierPrices.fileName})`,
        lineCount: count(),
      })
      .from(supplierPrices)
      .innerJoin(suppliers, eq(suppliers.id, supplierPrices.supplierId))
      .groupBy(
        supplierPrices.supplierId,
        suppliers.code,
        suppliers.name,
        supplierPrices.importedAt,
        supplierPrices.effectiveDate,
      )
      .orderBy(desc(supplierPrices.importedAt));

    return rows.map((row) => ({
      supplierId: row.supplierId,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      importedAt: row.importedAt,
      effectiveDate: row.effectiveDate,
      fileName: row.fileName,
      lineCount: Number(row.lineCount),
    }));
  },
};
