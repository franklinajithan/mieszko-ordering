import "server-only";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  productBarcodes,
  products,
  storeProducts,
  stores,
  supplierProducts,
  suppliers,
} from "@/db/schema";
import { barcodeLookupCandidates, formatSpreadsheetBarcode } from "@/utils/barcode";
import { isUnavailableSupplierCodeStored } from "@/lib/supplier-code-unavailable";
import { supplierCodeCompareKey } from "@/parsers/supplier-codes/supplier-code-file-parser";
import type { SupplierCodeDuplicateCounts, SupplierKey } from "@/types/product";

export const productRepository = {
  buildListConditions(filters?: {
    storeId?: number;
    department?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const conditions = [];
    if (filters?.storeId) {
      conditions.push(eq(storeProducts.storeId, filters.storeId));
    }
    if (filters?.department) {
      const departmentId = Number(filters.department);
      if (Number.isInteger(departmentId) && departmentId > 0) {
        conditions.push(eq(products.orderDepartment, departmentId));
      }
    }
    if (filters?.isActive !== undefined) {
      conditions.push(eq(products.isActive, filters.isActive));
      conditions.push(eq(storeProducts.isActive, filters.isActive));
    }
    const search = filters?.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(products.name, pattern),
          ilike(storeProducts.storeProductCode, pattern),
        )!,
      );
    }
    return conditions;
  },

  async list(filters?: {
    storeId?: number;
    department?: string;
    isActive?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = db
      .select({
        product: products,
        storeProduct: storeProducts,
        store: stores,
      })
      .from(storeProducts)
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .innerJoin(stores, eq(stores.id, storeProducts.storeId))
      .$dynamic();

    const conditions = productRepository.buildListConditions(filters);
    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    query = query.orderBy(products.name, storeProducts.storeProductCode);

    if (filters?.limit !== undefined) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset !== undefined) {
      query = query.offset(filters.offset);
    }

    return query;
  },

  async count(filters?: {
    storeId?: number;
    department?: string;
    isActive?: boolean;
    search?: string;
  }) {
    let query = db
      .select({ count: sql<number>`count(*)::int` })
      .from(storeProducts)
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .$dynamic();

    const conditions = productRepository.buildListConditions(filters);
    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    const [row] = await query;
    return row?.count ?? 0;
  },

  async getDuplicateProductNameKeys(filters?: {
    storeId?: number;
    department?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const conditions = productRepository.buildListConditions(filters);
    let query = db
      .select({
        nameKey: sql<string>`lower(trim(${products.name}))`,
        count: sql<number>`count(*)::int`,
      })
      .from(storeProducts)
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .$dynamic();

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    const rows = await query.groupBy(sql`lower(trim(${products.name}))`).having(sql`count(*) > 1`);

    return rows.map((row) => row.nameKey);
  },

  async getDuplicateSupplierCodeCounts(
    filters: {
      storeId?: number;
      department?: string;
      isActive?: boolean;
      search?: string;
    },
    pageProductIds: number[],
  ): Promise<Record<number, SupplierCodeDuplicateCounts>> {
    if (!pageProductIds.length || !filters.storeId) return {};

    // Supplier-code duplication is a store-level concern. It deliberately
    // ignores the current name/department/status filter so a duplicate stays
    // visible when one of its products is filtered out of the current page.
    const catalogProducts = await db
      .selectDistinct({
        productId: products.id,
        storeProductCode: storeProducts.storeProductCode,
      })
      .from(storeProducts)
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(eq(storeProducts.storeId, filters.storeId));
    const catalogProductIds = catalogProducts.map((row) => row.productId);
    const storeProductCodeByProductId = new Map(
      catalogProducts.map((row) => [row.productId, row.storeProductCode]),
    );
    if (!catalogProductIds.length) return {};

    const supplierKeys: SupplierKey[] = ["MM", "SP", "WAB"];
    const mappings = await db
      .select({
        productId: supplierProducts.productId,
        supplierKey: suppliers.code,
        supplierCode: supplierProducts.supplierCode,
      })
      .from(supplierProducts)
      .innerJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
      .where(
        and(
          inArray(supplierProducts.productId, catalogProductIds),
          inArray(suppliers.code, supplierKeys),
        ),
      );

    const productIdsByCode = new Map<string, Set<number>>();
    for (const mapping of mappings) {
      if (isUnavailableSupplierCodeStored(mapping.supplierCode)) continue;
      const key = `${mapping.supplierKey}|${supplierCodeCompareKey(mapping.supplierCode)}`;
      const productIds = productIdsByCode.get(key) ?? new Set<number>();
      productIds.add(mapping.productId);
      productIdsByCode.set(key, productIds);
    }

    const pageProductIdSet = new Set(pageProductIds);
    const countsByProductId: Record<number, SupplierCodeDuplicateCounts> = {};
    for (const mapping of mappings) {
      if (
        !pageProductIdSet.has(mapping.productId) ||
        isUnavailableSupplierCodeStored(mapping.supplierCode) ||
        !supplierKeys.includes(mapping.supplierKey as SupplierKey)
      ) {
        continue;
      }
      const supplierKey = mapping.supplierKey as SupplierKey;
      const key = `${supplierKey}|${supplierCodeCompareKey(mapping.supplierCode)}`;
      const otherStoreProductCodes = [...(productIdsByCode.get(key) ?? [])]
        .filter((productId) => productId !== mapping.productId)
        .map((productId) => storeProductCodeByProductId.get(productId))
        .filter((storeProductCode): storeProductCode is string => Boolean(storeProductCode))
        .sort((a, b) => a.localeCompare(b));
      if (!otherStoreProductCodes.length) continue;

      countsByProductId[mapping.productId] = {
        ...countsByProductId[mapping.productId],
        [supplierKey]: {
          count: otherStoreProductCodes.length,
          storeProductCodes: otherStoreProductCodes,
        },
      };
    }

    return countsByProductId;
  },

  async createProduct(data: typeof products.$inferInsert) {
    const [row] = await db.insert(products).values(data).returning();
    return row;
  },

  async getById(id: number) {
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return row ?? null;
  },

  async updateProduct(id: number, data: Partial<typeof products.$inferInsert>) {
    const [row] = await db
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return row;
  },

  /** Assign ordering department only — never touches imported `department`. */
  async assignOrderDepartment(id: number, orderDepartmentId: number | null) {
    const [row] = await db
      .update(products)
      .set({
        orderDepartment: orderDepartmentId,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();
    return row ?? null;
  },

  async addStoreProduct(data: typeof storeProducts.$inferInsert) {
    const [row] = await db.insert(storeProducts).values(data).returning();
    return row;
  },

  async upsertStoreProduct(data: typeof storeProducts.$inferInsert) {
    const [row] = await db
      .insert(storeProducts)
      .values(data)
      .onConflictDoUpdate({
        target: [storeProducts.storeId, storeProducts.storeProductCode],
        set: {
          productId: data.productId,
          isActive: data.isActive ?? true,
          ...(data.retailPrice !== undefined && data.retailPrice !== null
            ? { retailPrice: data.retailPrice }
            : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  async addBarcode(data: typeof productBarcodes.$inferInsert) {
    const [row] = await db.insert(productBarcodes).values(data).returning();
    return row;
  },

  async addBarcodeIfAbsent(data: typeof productBarcodes.$inferInsert) {
    const [row] = await db
      .insert(productBarcodes)
      .values(data)
      .onConflictDoNothing({
        target: [productBarcodes.storeId, productBarcodes.barcode],
      })
      .returning();
    return row ?? null;
  },

  async listStoreProductsForStore(storeId: number) {
    return db
      .select({
        storeProduct: storeProducts,
        product: products,
      })
      .from(storeProducts)
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(eq(storeProducts.storeId, storeId));
  },

  async listMspStoreProductsByCodes(codes: string[]) {
    if (!codes.length) return [];
    return db
      .select({
        storeProduct: storeProducts,
        product: products,
      })
      .from(storeProducts)
      .innerJoin(stores, eq(stores.id, storeProducts.storeId))
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(
        and(eq(stores.erpType, "msp"), inArray(storeProducts.storeProductCode, codes)),
      );
  },

  async createProductsBatch(data: Array<typeof products.$inferInsert>) {
    if (!data.length) return [];
    return db.insert(products).values(data).returning();
  },

  async upsertStoreProductsBatch(data: Array<typeof storeProducts.$inferInsert>) {
    if (!data.length) return [];
    return db
      .insert(storeProducts)
      .values(data)
      .onConflictDoUpdate({
        target: [storeProducts.storeId, storeProducts.storeProductCode],
        set: {
          productId: sql`excluded.product_id`,
          isActive: sql`excluded.is_active`,
          retailPrice: sql`COALESCE(excluded.retail_price, ${storeProducts.retailPrice})`,
          updatedAt: new Date(),
        },
      })
      .returning();
  },

  async insertBarcodesBatch(data: Array<typeof productBarcodes.$inferInsert>) {
    if (!data.length) return [];
    return db
      .insert(productBarcodes)
      .values(data)
      .onConflictDoNothing({
        target: [productBarcodes.storeId, productBarcodes.barcode],
      });
  },

  async addSupplierProduct(data: typeof supplierProducts.$inferInsert) {
    const [row] = await db.insert(supplierProducts).values(data).returning();
    return row;
  },

  async getBarcodesForStoreProduct(storeProductId: number) {
    return db
      .select()
      .from(productBarcodes)
      .where(eq(productBarcodes.storeProductId, storeProductId));
  },

  async getBarcodesForProduct(productId: number, storeId?: number) {
    const conditions = [eq(storeProducts.productId, productId)];
    if (storeId !== undefined) {
      conditions.push(eq(storeProducts.storeId, storeId));
    }
    return db
      .select({
        id: productBarcodes.id,
        barcode: productBarcodes.barcode,
        storeProductId: productBarcodes.storeProductId,
        storeId: productBarcodes.storeId,
      })
      .from(productBarcodes)
      .innerJoin(
        storeProducts,
        eq(storeProducts.id, productBarcodes.storeProductId),
      )
      .where(and(...conditions));
  },

  async findStoreProductForProduct(productId: number, storeId: number) {
    const [row] = await db
      .select()
      .from(storeProducts)
      .where(
        and(
          eq(storeProducts.productId, productId),
          eq(storeProducts.storeId, storeId),
        ),
      );
    return row ?? null;
  },

  async getSupplierProducts(productId: number) {
    return db
      .select({ supplierProduct: supplierProducts, supplier: suppliers })
      .from(supplierProducts)
      .innerJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
      .where(eq(supplierProducts.productId, productId));
  },

  async findStoreProductByCode(storeId: number, code: string) {
    const [row] = await db
      .select()
      .from(storeProducts)
      .where(
        and(
          eq(storeProducts.storeId, storeId),
          eq(storeProducts.storeProductCode, code),
        ),
      );
    return row ?? null;
  },

  async findStoreProductsByCodes(storeId: number, codes: string[]) {
    if (!codes.length) return [];
    return db
      .select()
      .from(storeProducts)
      .where(
        and(
          eq(storeProducts.storeId, storeId),
          inArray(storeProducts.storeProductCode, codes),
        ),
      );
  },

  async findStoreProductsByLowercaseCodes(storeId: number, lowerCodes: string[]) {
    if (!lowerCodes.length) return [];
    return db
      .select()
      .from(storeProducts)
      .where(
        and(
          eq(storeProducts.storeId, storeId),
          inArray(sql`lower(${storeProducts.storeProductCode})`, lowerCodes),
        ),
      );
  },

  async findMspStoreProductByCode(code: string) {
    const [row] = await db
      .select({
        storeProduct: storeProducts,
        product: products,
      })
      .from(storeProducts)
      .innerJoin(stores, eq(stores.id, storeProducts.storeId))
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(and(eq(stores.erpType, "msp"), eq(storeProducts.storeProductCode, code)))
      .limit(1);
    return row ?? null;
  },

  async findStoreProductByBarcode(storeId: number, barcode: string) {
    const candidates = barcodeLookupCandidates(barcode);
    if (!candidates.length) return null;
    const [row] = await db
      .select({ storeProduct: storeProducts })
      .from(productBarcodes)
      .innerJoin(
        storeProducts,
        eq(storeProducts.id, productBarcodes.storeProductId),
      )
      .where(
        and(
          eq(productBarcodes.storeId, storeId),
          inArray(productBarcodes.barcode, candidates),
        ),
      )
      .limit(1);
    return row?.storeProduct ?? null;
  },

  async findStoreProductsByBarcodes(storeId: number, barcodes: string[]) {
    if (!barcodes.length) return [];
    return db
      .select({
        barcode: productBarcodes.barcode,
        storeProduct: storeProducts,
      })
      .from(productBarcodes)
      .innerJoin(
        storeProducts,
        eq(storeProducts.id, productBarcodes.storeProductId),
      )
      .where(
        and(
          eq(productBarcodes.storeId, storeId),
          inArray(productBarcodes.barcode, barcodes),
        ),
      );
  },

  async findStoreProductMatchesForFileBarcodes(storeId: number, fileBarcodes: string[]) {
    const unique = [
      ...new Set(
        fileBarcodes.map((b) => formatSpreadsheetBarcode(b).trim()).filter(Boolean),
      ),
    ];
    if (!unique.length) return [];

    const catalogRows = await db
      .select({
        barcode: productBarcodes.barcode,
        storeProductId: storeProducts.id,
        storeProductCode: storeProducts.storeProductCode,
        productName: products.name,
      })
      .from(productBarcodes)
      .innerJoin(
        storeProducts,
        eq(storeProducts.id, productBarcodes.storeProductId),
      )
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(eq(productBarcodes.storeId, storeId));

    type CatalogHit = (typeof catalogRows)[number];
    const catalogByCandidate = new Map<string, CatalogHit>();
    for (const row of catalogRows) {
      for (const candidate of barcodeLookupCandidates(row.barcode)) {
        if (!catalogByCandidate.has(candidate)) catalogByCandidate.set(candidate, row);
      }
    }

    const matches: Array<{
      fileBarcode: string;
      storeProductId: number;
      storeProductCode: string;
      productName: string | null;
    }> = [];

    for (const fileBarcode of unique) {
      for (const candidate of barcodeLookupCandidates(fileBarcode)) {
        const hit = catalogByCandidate.get(candidate);
        if (hit) {
          matches.push({
            fileBarcode,
            storeProductId: hit.storeProductId,
            storeProductCode: hit.storeProductCode,
            productName: hit.productName,
          });
          break;
        }
      }
    }

    return matches;
  },

  async findStoreProductBySupplierCode(
    storeId: number,
    supplierId: number,
    supplierCode: string,
  ) {
    const [row] = await db
      .select({ storeProduct: storeProducts })
      .from(supplierProducts)
      .innerJoin(storeProducts, eq(storeProducts.productId, supplierProducts.productId))
      .where(
        and(
          eq(supplierProducts.supplierId, supplierId),
          eq(supplierProducts.supplierCode, supplierCode),
          eq(storeProducts.storeId, storeId),
        ),
      );
    return row?.storeProduct ?? null;
  },

  async findSupplierProductByCode(supplierId: number, supplierCode: string) {
    const [row] = await db
      .select()
      .from(supplierProducts)
      .where(
        and(
          eq(supplierProducts.supplierId, supplierId),
          eq(supplierProducts.supplierCode, supplierCode),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async findSupplierProductsByCodes(supplierId: number, codes: string[]) {
    if (!codes.length) return [];
    return db
      .select()
      .from(supplierProducts)
      .where(
        and(
          eq(supplierProducts.supplierId, supplierId),
          inArray(supplierProducts.supplierCode, codes),
        ),
      );
  },

  async listSupplierProductsForProductIds(productIds: number[]) {
    if (!productIds.length) return [];
    return db
      .select()
      .from(supplierProducts)
      .where(inArray(supplierProducts.productId, productIds));
  },

  /** Upsert supplier code for a product: update existing link for this supplier, or insert. */
  async upsertSupplierProduct(input: {
    productId: number;
    supplierId: number;
    supplierCode: string;
    isActive?: boolean;
  }) {
    const isActive = input.isActive ?? true;
    const [existingForProduct] = await db
      .select()
      .from(supplierProducts)
      .where(
        and(
          eq(supplierProducts.productId, input.productId),
          eq(supplierProducts.supplierId, input.supplierId),
        ),
      )
      .limit(1);

    if (existingForProduct) {
      if (
        existingForProduct.supplierCode === input.supplierCode &&
        existingForProduct.isActive === isActive
      ) {
        return { row: existingForProduct, action: "unchanged" as const };
      }
      const [updated] = await db
        .update(supplierProducts)
        .set({
          supplierCode: input.supplierCode,
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(supplierProducts.id, existingForProduct.id))
        .returning();
      return { row: updated, action: "updated" as const };
    }

    const [inserted] = await db
      .insert(supplierProducts)
      .values({
        productId: input.productId,
        supplierId: input.supplierId,
        supplierCode: input.supplierCode,
        isActive,
      })
      .returning();
    return { row: inserted, action: "created" as const };
  },

  async getDepartments(storeId?: number) {
    if (storeId) {
      const rows = await db
        .selectDistinct({ department: products.department })
        .from(storeProducts)
        .innerJoin(products, eq(products.id, storeProducts.productId))
        .where(eq(storeProducts.storeId, storeId))
        .orderBy(products.department);
      return rows.map((r) => r.department);
    }

    const rows = await db
      .selectDistinct({ department: products.department })
      .from(products)
      .orderBy(products.department);
    return rows.map((r) => r.department);
  },
};
