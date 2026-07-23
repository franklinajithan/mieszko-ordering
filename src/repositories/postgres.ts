import "server-only";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailySales,
  departments,
  bookStockImports,
  bookStockItems,
  orderItemSupplierPrices,
  orderItems,
  orders,
  orderPriceSuppliers,
  orderSalesPeriods,
  orderStockEventItems,
  orderStockEvents,
  orderUploads,
  productBarcodes,
  products,
  storeProducts,
  supplierPriceImports,
  supplierPrices,
  supplierProducts,
  suppliers,
  stores,
} from "@/db/schema";

export const storeRepository = {
  async list() {
    return db.select().from(stores).orderBy(stores.name);
  },

  async getById(id: number) {
    const [row] = await db.select().from(stores).where(eq(stores.id, id));
    return row ?? null;
  },

  async create(data: typeof stores.$inferInsert) {
    const [row] = await db.insert(stores).values(data).returning();
    return row;
  },

  async update(id: number, data: Partial<typeof stores.$inferInsert>) {
    const [row] = await db
      .update(stores)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(stores.id, id))
      .returning();
    return row;
  },
};

export const supplierRepository = {
  async list() {
    return db.select().from(suppliers).orderBy(suppliers.priceTiePriority);
  },

  async getActive() {
    return db
      .select()
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(suppliers.priceTiePriority);
  },

  async create(data: typeof suppliers.$inferInsert) {
    const [row] = await db.insert(suppliers).values(data).returning();
    return row;
  },

  async update(id: number, data: Partial<typeof suppliers.$inferInsert>) {
    const [row] = await db
      .update(suppliers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning();
    return row;
  },
};

let ensureDepartmentsTablePromise: Promise<void> | null = null;

function isMissingRelationError(error: unknown, relation = "departments") {
  const cause = error instanceof Error ? error.cause : null;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return false;
  if (cause.code !== "42P01") return false;
  const message = "message" in cause ? String(cause.message) : "";
  return message.includes(relation);
}

async function ensureDepartmentsTable() {
  if (!ensureDepartmentsTablePromise) {
    ensureDepartmentsTablePromise = db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS departments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL UNIQUE,
          code VARCHAR(50),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .then(() => undefined)
      .catch((error) => {
        ensureDepartmentsTablePromise = null;
        throw error;
      });
  }
  return ensureDepartmentsTablePromise;
}

async function listLegacyDepartmentNames() {
  const legacy = await db
    .selectDistinct({ department: products.department })
    .from(products)
    .orderBy(products.department);
  return legacy.map((r) => r.department);
}

export const departmentRepository = {
  async list() {
    await ensureDepartmentsTable();
    return db.select().from(departments).orderBy(departments.name);
  },

  async getById(id: string) {
    await ensureDepartmentsTable();
    const [row] = await db
      .select()
      .from(departments)
      .where(eq(departments.id, id));
    return row ?? null;
  },

  async getByName(name: string) {
    await ensureDepartmentsTable();
    const [row] = await db
      .select()
      .from(departments)
      .where(eq(departments.name, name));
    return row ?? null;
  },

  async create(data: typeof departments.$inferInsert) {
    await ensureDepartmentsTable();
    const [row] = await db.insert(departments).values(data).returning();
    return row;
  },

  async update(id: string, data: Partial<typeof departments.$inferInsert>) {
    await ensureDepartmentsTable();
    const existing = await departmentRepository.getById(id);
    if (!existing) return null;

    const [row] = await db
      .update(departments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();

    if (data.name && data.name !== existing.name) {
      await db
        .update(products)
        .set({ department: data.name, updatedAt: new Date() })
        .where(eq(products.department, existing.name));
    }

    return row;
  },

  async listActiveNames() {
    try {
      await ensureDepartmentsTable();
      const rows = await db
        .select({ name: departments.name })
        .from(departments)
        .where(eq(departments.isActive, true))
        .orderBy(departments.name);

      if (rows.length > 0) {
        return rows.map((r) => r.name);
      }
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
    }

    return listLegacyDepartmentNames();
  },
};

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
      conditions.push(eq(products.department, filters.department));
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

export const dailySalesRepository = {
  async upsertSale(data: typeof dailySales.$inferInsert) {
    const [row] = await db
      .insert(dailySales)
      .values(data)
      .onConflictDoUpdate({
        target: [dailySales.storeProductId, dailySales.salesDate],
        set: {
          soldQty: data.soldQty,
          rtcQty: null,
          promoQty: null,
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

export const supplierPriceRepository = {
  async createImport(data: typeof supplierPriceImports.$inferInsert) {
    const [row] = await db
      .insert(supplierPriceImports)
      .values(data)
      .returning();
    return row;
  },

  async insertPrices(rows: Array<typeof supplierPrices.$inferInsert>) {
    if (!rows.length) return [];
    return db.insert(supplierPrices).values(rows).returning();
  },

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
      .orderBy(desc(supplierPrices.effectiveDate), desc(supplierPrices.createdAt))
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
};

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

export const orderRepository = {
  async list() {
    return db
      .select({
        order: orders,
        store: stores,
      })
      .from(orders)
      .innerJoin(stores, eq(stores.id, orders.storeId))
      .orderBy(desc(orders.createdAt));
  },

  async getById(orderId: number) {
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    return row ?? null;
  },

  async create(data: typeof orders.$inferInsert) {
    const [row] = await db.insert(orders).values(data).returning();
    return row;
  },

  async update(orderId: number, data: Partial<typeof orders.$inferInsert>) {
    const [row] = await db
      .update(orders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();
    return row;
  },

  async replacePeriods(
    orderId: number,
    periods: Array<typeof orderSalesPeriods.$inferInsert>,
  ) {
    await db
      .delete(orderSalesPeriods)
      .where(eq(orderSalesPeriods.orderId, orderId));
    if (periods.length) {
      await db.insert(orderSalesPeriods).values(periods);
    }
  },

  async replacePriceSuppliers(orderId: number, supplierIds: number[]) {
    await db
      .delete(orderPriceSuppliers)
      .where(eq(orderPriceSuppliers.orderId, orderId));
    if (supplierIds.length) {
      await db.insert(orderPriceSuppliers).values(
        supplierIds.map((supplierId) => ({ orderId, supplierId })),
      );
    }
  },

  async getPeriods(orderId: number) {
    return db
      .select()
      .from(orderSalesPeriods)
      .where(eq(orderSalesPeriods.orderId, orderId));
  },

  async getSelectedSuppliers(orderId: number) {
    return db
      .select({ supplier: suppliers })
      .from(orderPriceSuppliers)
      .innerJoin(suppliers, eq(suppliers.id, orderPriceSuppliers.supplierId))
      .where(eq(orderPriceSuppliers.orderId, orderId))
      .orderBy(suppliers.priceTiePriority);
  },

  async createUpload(data: typeof orderUploads.$inferInsert) {
    const [row] = await db.insert(orderUploads).values(data).returning();
    return row;
  },

  async createStockEvent(data: typeof orderStockEvents.$inferInsert) {
    const [row] = await db.insert(orderStockEvents).values(data).returning();
    return row;
  },

  async createStockEventItems(
    rows: Array<typeof orderStockEventItems.$inferInsert>,
  ) {
    if (!rows.length) return [];
    return db.insert(orderStockEventItems).values(rows).returning();
  },

  async getStoreProductsForOrder(storeId: number, departments: string[]) {
    const conditions = [eq(storeProducts.storeId, storeId), eq(storeProducts.isActive, true)];
    if (departments.length) {
      conditions.push(inArray(products.department, departments));
    }
    return db
      .select({
        storeProduct: storeProducts,
        product: products,
      })
      .from(storeProducts)
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(and(...conditions))
      .orderBy(products.name);
  },

  async getStockEvents(orderId: number) {
    return db
      .select({
        event: orderStockEvents,
        item: orderStockEventItems,
      })
      .from(orderStockEvents)
      .leftJoin(
        orderStockEventItems,
        eq(orderStockEventItems.eventId, orderStockEvents.id),
      )
      .where(eq(orderStockEvents.orderId, orderId))
      .orderBy(orderStockEvents.eventDate, orderStockEvents.sortOrder);
  },

  async clearBookStockEvents(orderId: number) {
    await db
      .delete(orderStockEvents)
      .where(
        and(
          eq(orderStockEvents.orderId, orderId),
          eq(orderStockEvents.eventType, "book_stock"),
        ),
      );
  },

  async clearCalculatedItems(orderId: number) {
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  },

  async insertOrderItems(rows: Array<typeof orderItems.$inferInsert>) {
    if (!rows.length) return [];
    return db.insert(orderItems).values(rows).returning();
  },

  async insertItemSupplierPrices(
    rows: Array<typeof orderItemSupplierPrices.$inferInsert>,
  ) {
    if (!rows.length) return [];
    return db.insert(orderItemSupplierPrices).values(rows).returning();
  },

  async getOrderItemsWithDetails(orderId: number) {
    return db
      .select({
        item: orderItems,
        storeProduct: storeProducts,
        product: products,
      })
      .from(orderItems)
      .innerJoin(storeProducts, eq(storeProducts.id, orderItems.storeProductId))
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(storeProducts.storeProductCode);
  },

  async getItemSupplierPrices(orderId: number) {
    return db
      .select({
        price: orderItemSupplierPrices,
        supplier: suppliers,
      })
      .from(orderItemSupplierPrices)
      .innerJoin(orderItems, eq(orderItems.id, orderItemSupplierPrices.orderItemId))
      .innerJoin(suppliers, eq(suppliers.id, orderItemSupplierPrices.supplierId))
      .where(eq(orderItems.orderId, orderId));
  },

  async updateFinalQuantity(orderItemId: number, finalOrderQty: string) {
    const [row] = await db
      .update(orderItems)
      .set({ finalOrderQty })
      .where(eq(orderItems.id, orderItemId))
      .returning();
    return row;
  },

  async getOrderItem(orderItemId: number) {
    const [row] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, orderItemId));
    return row ?? null;
  },
};
