import { decimalToDb, parseDbDecimal } from "@/utils/decimal";
import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  orderItemSupplierPrices,
  orderItems,
  orders,
  departments,
  products,
  storeProducts,
  suppliers,
} from "@/db/schema";

function chunkRows<T>(rows: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
}

export const orderRepository = {
  async list() {
    return db.select().from(orders).orderBy(desc(orders.createdAt));
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
      .set({ ...data, updatedAt: new Date(), revision:sql`${orders.revision}+1` })
      .where(eq(orders.id, orderId))
      .returning();
    return row;
  },

  async getPeriods(orderId: number) {
    const order = await this.getById(orderId);
    return (order?.comparisonPeriods ?? []).map((period, index) => ({
      periodKey: `period_${index + 1}`,
      startDate: period.startDate,
      endDate: period.endDate,
    }));
  },

  async getSelectedSuppliers(orderId: number) {
    const order = await this.getById(orderId);
    const supplierIds = order?.supplierIds ?? [];
    if (!supplierIds.length) return [];
    const rows = await db
      .select()
      .from(suppliers)
      .where(inArray(suppliers.id, supplierIds))
      .orderBy(suppliers.priceTiePriority);
    return rows.map((supplier) => ({ supplier }));
  },

  async replacePeriods(
    orderId: number,
    periods: Array<{ startDate: string; endDate: string }>,
  ) {
    return this.update(orderId, { comparisonPeriods: periods });
  },

  async replacePriceSuppliers(orderId: number, supplierIds: number[]) {
    return this.update(orderId, { supplierIds });
  },

  async getStoreProductsForOrder(storeId: number, departmentIds: number[]) {
    const conditions = [eq(storeProducts.storeId, storeId), eq(storeProducts.isActive, true), eq(products.isActive, true)];
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

  async replaceCalculatedItems(
    orderId: number,
    rows: Array<typeof orderItems.$inferInsert>,
    header?: Partial<typeof orders.$inferInsert>,
  ) {
    return db.transaction(async (tx) => {
      // Serialise competing recalculations of the same order.
      const [locked] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!locked) throw new Error("Order not found");

      const previous = await tx.select().from(orderItems).where(eq(orderItems.orderId,orderId));
      const overrides = new Map(previous.filter(item => item.quantityOverridden).map(item => [item.storeProductId,item.finalOrderQty]));
      const preservedRows = rows.map(row => {
        const finalOrderQty = overrides.get(row.storeProductId);
        return finalOrderQty === undefined ? row : {...row, finalOrderQty, quantityOverridden:true,
          estimatedLineCost: row.cheapestNetPrice ? decimalToDb(parseDbDecimal(finalOrderQty).times(parseDbDecimal(row.cheapestNetPrice))) : null};
      });
      await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
      const inserted: Array<typeof orderItems.$inferSelect> = [];
      for (const batch of chunkRows(preservedRows, 250)) {
        inserted.push(...(await tx.insert(orderItems).values(batch).returning()));
      }

      const snapshots = inserted.flatMap((row) =>
        (row.supplierQuotes ?? []).map((quote) => ({
          orderItemId: row.id,
          supplierId: quote.supplierId,
          supplierCode: quote.supplierProductCode,
          netPrice: quote.netPrice,
          caseSize: quote.caseSize,
          priceValidationStatus: quote.priceValidationStatus,
          isCheapest: quote.isCheapest,
          failureReason: quote.failureReason,
        })),
      );
      for (const batch of chunkRows(snapshots, 250)) {
        await tx.insert(orderItemSupplierPrices).values(batch);
      }
      await tx.update(orders)
        .set({ ...header, status: "calculated", calculatedAt:new Date(), updatedAt: new Date(), revision:sql`${orders.revision}+1` })
        .where(eq(orders.id, orderId));
      return inserted;
    });
  },

  async clearCalculatedItems(orderId: number) {
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  },

  async insertOrderItems(rows: Array<typeof orderItems.$inferInsert>) {
    if (!rows.length) return [];
    const inserted: Array<typeof orderItems.$inferSelect> = [];
    for (const batch of chunkRows(rows, 250)) {
      inserted.push(...(await db.insert(orderItems).values(batch).returning()));
    }
    return inserted;
  },

  async insertItemSupplierPrices(
    rows: Array<typeof orderItemSupplierPrices.$inferInsert>,
  ) {
    if (!rows.length) return [];
    const inserted: Array<typeof orderItemSupplierPrices.$inferSelect> = [];
    for (const batch of chunkRows(rows, 250)) {
      inserted.push(
        ...(await db.insert(orderItemSupplierPrices).values(batch).returning()),
      );
    }
    return inserted;
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
    return db.transaction(async tx => {
      const [item]=await tx.select().from(orderItems).where(eq(orderItems.id,orderItemId));
      if (!item) throw new Error("Order item not found");
      await tx.select({id:orders.id}).from(orders).where(eq(orders.id,item.orderId)).for("update");
      const [row]=await tx.update(orderItems)
        .set({finalOrderQty,quantityOverridden:true,estimatedLineCost:sql`${finalOrderQty}::numeric * ${orderItems.cheapestNetPrice}`})
        .where(eq(orderItems.id,orderItemId)).returning();
      await tx.update(orders).set({updatedAt:new Date(),status:"draft",revision:sql`${orders.revision}+1`}).where(eq(orders.id,item.orderId));
      return row;
    });
  },

  async getOrderItem(orderItemId: number) {
    const [row] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, orderItemId));
    return row ?? null;
  },
};
