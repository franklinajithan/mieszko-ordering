import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  orderItemSupplierPrices,
  orderItems,
  orders,
  orderPriceSuppliers,
  orderSalesPeriods,
  orderStockEventItems,
  orderStockEvents,
  orderUploads,
  departments,
  products,
  storeProducts,
  suppliers,
  stores,
} from "@/db/schema";

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

  async getStoreProductsForOrder(storeId: number, departmentIds: number[]) {
    const conditions = [eq(storeProducts.storeId, storeId), eq(storeProducts.isActive, true)];
    if (departmentIds.length) {
      conditions.push(inArray(products.orderDepartment, departmentIds));
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
        orderDepartmentName: departments.name,
      })
      .from(orderItems)
      .innerJoin(storeProducts, eq(storeProducts.id, orderItems.storeProductId))
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .leftJoin(departments, eq(departments.id, products.orderDepartment))
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
