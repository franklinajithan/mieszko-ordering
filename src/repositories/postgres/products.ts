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
      .onConflictDoNothing({ target: productBarcodes.barcode })
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

  async listBarcodeSet() {
    const rows = await db
      .select({ barcode: productBarcodes.barcode })
      .from(productBarcodes);
    return new Set(rows.map((row) => row.barcode));
  },

  async insertBarcodesBatch(data: Array<typeof productBarcodes.$inferInsert>) {
    if (!data.length) return [];
    return db
      .insert(productBarcodes)
      .values(data)
      .onConflictDoNothing({ target: productBarcodes.barcode });
  },

  async addSupplierProduct(data: typeof supplierProducts.$inferInsert) {
    const [row] = await db.insert(supplierProducts).values(data).returning();
    return row;
  },

  async getBarcodes(productId: number) {
    return db
      .select()
      .from(productBarcodes)
      .where(eq(productBarcodes.productId, productId));
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
    const [row] = await db
      .select({ storeProduct: storeProducts })
      .from(productBarcodes)
      .innerJoin(products, eq(products.id, productBarcodes.productId))
      .innerJoin(storeProducts, eq(storeProducts.productId, products.id))
      .where(
        and(
          eq(productBarcodes.barcode, barcode),
          eq(storeProducts.storeId, storeId),
        ),
      );
    return row?.storeProduct ?? null;
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
