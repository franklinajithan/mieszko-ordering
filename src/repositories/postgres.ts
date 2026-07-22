import "server-only";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailySales,
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

  async getById(id: string) {
    const [row] = await db.select().from(stores).where(eq(stores.id, id));
    return row ?? null;
  },

  async create(data: typeof stores.$inferInsert) {
    const [row] = await db.insert(stores).values(data).returning();
    return row;
  },

  async update(id: string, data: Partial<typeof stores.$inferInsert>) {
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

  async update(id: string, data: Partial<typeof suppliers.$inferInsert>) {
    const [row] = await db
      .update(suppliers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning();
    return row;
  },
};

export const productRepository = {
  async list(filters?: {
    storeId?: string;
    department?: string;
    isActive?: boolean;
  }) {
    let query = db
      .select({
        product: products,
        storeProduct: storeProducts,
        store: stores,
      })
      .from(products)
      .innerJoin(storeProducts, eq(storeProducts.productId, products.id))
      .innerJoin(stores, eq(stores.id, storeProducts.storeId))
      .$dynamic();

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

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(products.name);
  },

  async createProduct(data: typeof products.$inferInsert) {
    const [row] = await db.insert(products).values(data).returning();
    return row;
  },

  async updateProduct(id: string, data: Partial<typeof products.$inferInsert>) {
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

  async addBarcode(data: typeof productBarcodes.$inferInsert) {
    const [row] = await db.insert(productBarcodes).values(data).returning();
    return row;
  },

  async addSupplierProduct(data: typeof supplierProducts.$inferInsert) {
    const [row] = await db.insert(supplierProducts).values(data).returning();
    return row;
  },

  async getBarcodes(productId: string) {
    return db
      .select()
      .from(productBarcodes)
      .where(eq(productBarcodes.productId, productId));
  },

  async getSupplierProducts(productId: string) {
    return db
      .select({ supplierProduct: supplierProducts, supplier: suppliers })
      .from(supplierProducts)
      .innerJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
      .where(eq(supplierProducts.productId, productId));
  },

  async findStoreProductByCode(storeId: string, code: string) {
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

  async findStoreProductByBarcode(storeId: string, barcode: string) {
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
    storeId: string,
    supplierId: string,
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

  async getDepartments() {
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
    storeProductId: string,
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

  async getSalesForProduct(storeProductId: string) {
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

  async getLatestPrice(supplierProductId: string, asOfDate: string) {
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

  async findSupplierProduct(supplierId: string, supplierCode: string) {
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

  async getById(orderId: string) {
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    return row ?? null;
  },

  async create(data: typeof orders.$inferInsert) {
    const [row] = await db.insert(orders).values(data).returning();
    return row;
  },

  async update(orderId: string, data: Partial<typeof orders.$inferInsert>) {
    const [row] = await db
      .update(orders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();
    return row;
  },

  async replacePeriods(
    orderId: string,
    periods: Array<typeof orderSalesPeriods.$inferInsert>,
  ) {
    await db
      .delete(orderSalesPeriods)
      .where(eq(orderSalesPeriods.orderId, orderId));
    if (periods.length) {
      await db.insert(orderSalesPeriods).values(periods);
    }
  },

  async replacePriceSuppliers(orderId: string, supplierIds: string[]) {
    await db
      .delete(orderPriceSuppliers)
      .where(eq(orderPriceSuppliers.orderId, orderId));
    if (supplierIds.length) {
      await db.insert(orderPriceSuppliers).values(
        supplierIds.map((supplierId) => ({ orderId, supplierId })),
      );
    }
  },

  async getPeriods(orderId: string) {
    return db
      .select()
      .from(orderSalesPeriods)
      .where(eq(orderSalesPeriods.orderId, orderId));
  },

  async getSelectedSuppliers(orderId: string) {
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

  async getStoreProductsForOrder(storeId: string, departments: string[]) {
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

  async getStockEvents(orderId: string) {
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

  async clearCalculatedItems(orderId: string) {
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

  async getOrderItemsWithDetails(orderId: string) {
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

  async getItemSupplierPrices(orderId: string) {
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

  async updateFinalQuantity(orderItemId: string, finalOrderQty: string) {
    const [row] = await db
      .update(orderItems)
      .set({ finalOrderQty })
      .where(eq(orderItems.id, orderItemId))
      .returning();
    return row;
  },

  async getOrderItem(orderItemId: string) {
    const [row] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, orderItemId));
    return row ?? null;
  },
};
