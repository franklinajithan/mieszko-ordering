import "server-only";
import { and, count, desc, eq, inArray, lte, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { supplierPrices, supplierProducts, suppliers } from "@/db/schema";
import { BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE } from "@/lib/import-config";

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
   * Prefer the latest effective date, then the latest import and deterministic id.
   */
  async getLatestPrice(supplierProductId: number, asOfDate: string) {
    const [row] = await db
      .select()
      .from(supplierPrices)
      .where(
        and(
          eq(supplierPrices.supplierProductId, supplierProductId),
          lte(supplierPrices.effectiveDate, asOfDate),
          or(isNull(supplierPrices.validUntil),gte(supplierPrices.validUntil,asOfDate)),
        ),
      )
      .orderBy(desc(supplierPrices.effectiveDate), desc(supplierPrices.importedAt), desc(supplierPrices.id))
      .limit(1);
    return row ?? null;
  },

  async listActiveMappings(productIds: number[], supplierIds: number[]) {
    const uniqueProductIds = [...new Set(productIds)];
    const uniqueSupplierIds = [...new Set(supplierIds)];
    if (!uniqueProductIds.length || !uniqueSupplierIds.length) return [];

    const rows: Array<typeof supplierProducts.$inferSelect> = [];
    for (
      let index = 0;
      index < uniqueProductIds.length;
      index += BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE
    ) {
      const batch = uniqueProductIds.slice(
        index,
        index + BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE,
      );
      if (!batch.length) continue;
      rows.push(
        ...(await db
          .select()
          .from(supplierProducts)
          .where(
            and(
              inArray(supplierProducts.productId, batch),
              inArray(supplierProducts.supplierId, uniqueSupplierIds),
              eq(supplierProducts.isActive, true),
            ),
          )),
      );
    }
    return rows;
  },

  async getLatestPricesForSupplierProducts(
    supplierProductIds: number[],
    asOfDate: string,
  ) {
    const uniqueIds = [...new Set(supplierProductIds.filter((id) => id > 0))];
    const prices = new Map<number, { netPrice: string; caseSize: string | null }>();
    if (!uniqueIds.length) return prices;

    for (
      let index = 0;
      index < uniqueIds.length;
      index += BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE
    ) {
      const batch = uniqueIds.slice(index, index + BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE);
      if (!batch.length) continue;
      const rows = await db
        .selectDistinctOn([supplierPrices.supplierProductId], {
          supplierProductId: supplierPrices.supplierProductId,
          netPrice: supplierPrices.netPrice,
          caseSize: supplierPrices.caseSize,
        })
        .from(supplierPrices)
        .where(
          and(
            inArray(supplierPrices.supplierProductId, batch),
            lte(supplierPrices.effectiveDate, asOfDate),
            or(isNull(supplierPrices.validUntil),gte(supplierPrices.validUntil,asOfDate)),
          ),
        )
        .orderBy(
          supplierPrices.supplierProductId,
          desc(supplierPrices.effectiveDate),
          desc(supplierPrices.importedAt),
          desc(supplierPrices.id),
        );

      for (const row of rows) {
        if (row.supplierProductId == null) continue;
        prices.set(row.supplierProductId, {
          netPrice: row.netPrice,
          caseSize: row.caseSize,
        });
      }
    }

    return prices;
  },

  async findSupplierProducts(supplierId: number, supplierCode: string) {
    return db
      .select()
      .from(supplierProducts)
      .where(
        and(
          eq(supplierProducts.supplierId, supplierId),
          eq(supplierProducts.supplierCode, supplierCode),
        ),
      );
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
