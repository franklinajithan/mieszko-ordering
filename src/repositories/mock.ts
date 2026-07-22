import "server-only";
import { randomUUID } from "crypto";
import type * as schema from "@/db/schema";

type Store = typeof schema.stores.$inferSelect;
type Supplier = typeof schema.suppliers.$inferSelect;
type Product = typeof schema.products.$inferSelect;
type StoreProduct = typeof schema.storeProducts.$inferSelect;
type Order = typeof schema.orders.$inferSelect;
type OrderItem = typeof schema.orderItems.$inferSelect;
type Barcode = typeof schema.productBarcodes.$inferSelect;
type SupplierProduct = typeof schema.supplierProducts.$inferSelect;

const now = () => new Date();

const MOCK_STORE_ID = "mock-store-001";
const MOCK_MM_ID = "mock-supplier-mm";
const MOCK_SP_ID = "mock-supplier-sp";
const MOCK_WAB_ID = "mock-supplier-wab";
export const MOCK_DEMO_ORDER_ID = "mock-order-demo-001";

function row<T extends Record<string, unknown>>(value: T): T {
  return value;
}

function seedState() {
  const stores: Store[] = [
    row({
      id: MOCK_STORE_ID,
      name: "Dublin Central",
      code: "DUB01",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: "mock-store-002",
      name: "Cork South",
      code: "CRK01",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const suppliers: Supplier[] = [
    row({
      id: MOCK_MM_ID,
      name: "MM",
      code: "MM",
      priceTiePriority: 1,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: MOCK_SP_ID,
      name: "SP",
      code: "SP",
      priceTiePriority: 2,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: MOCK_WAB_ID,
      name: "WAB",
      code: "WAB",
      priceTiePriority: 3,
      isActive: false,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const products: Product[] = [
    row({
      id: "mock-product-001",
      name: "Fresh Milk 2L",
      department: "Dairy",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: "mock-product-002",
      name: "Cheddar Block 400g",
      department: "Cheese",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: "mock-product-003",
      name: "Natural Yogurt 500g",
      department: "Dairy",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const storeProducts: StoreProduct[] = [
    row({
      id: "mock-sp-001",
      storeId: MOCK_STORE_ID,
      productId: "mock-product-001",
      storeProductCode: "1001",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: "mock-sp-002",
      storeId: MOCK_STORE_ID,
      productId: "mock-product-002",
      storeProductCode: "2001",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: "mock-sp-003",
      storeId: MOCK_STORE_ID,
      productId: "mock-product-003",
      storeProductCode: "1002",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const barcodes: Barcode[] = [
    row({
      id: "mock-bc-001",
      productId: "mock-product-001",
      barcode: "5012345678901",
      createdAt: now(),
    }),
  ];

  const supplierProducts: SupplierProduct[] = [
    row({
      id: "mock-sup-prod-001",
      productId: "mock-product-001",
      supplierId: MOCK_MM_ID,
      supplierCode: "MM1001",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: "mock-sup-prod-002",
      productId: "mock-product-001",
      supplierId: MOCK_SP_ID,
      supplierCode: "SP1001",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const orders: Order[] = [
    row({
      id: MOCK_DEMO_ORDER_ID,
      storeId: MOCK_STORE_ID,
      bookStockDate: "2026-07-14",
      clientDeliveryDate: "2026-07-21",
      departmentFilters: [],
      notes: "Demo order for UI preview",
      status: "calculated",
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const orderItems: OrderItem[] = [
    row({
      id: "mock-oi-001",
      orderId: MOCK_DEMO_ORDER_ID,
      storeProductId: "mock-sp-001",
      period1Sales: "120.0000",
      period2Sales: "98.0000",
      period3Sales: "110.0000",
      previousYearSales: "105.0000",
      highestSoldQty: "120.0000",
      bookStockQty: "45.0000",
      receivedNotPostedQty: "10.0000",
      futureDeliveryTotalQty: "0.0000",
      forecastSalesQty: "35.0000",
      shortageQty: "0.0000",
      projectedFinalStockQty: "20.0000",
      suggestedOrderQty: "100.0000",
      finalOrderQty: "100.0000",
      priceStatus: "complete",
      cheapestSupplierId: MOCK_SP_ID,
      cheapestNetPrice: "1.8500",
      estimatedLineCost: "185.0000",
      calculationBreakdown: [],
      warning: null,
    }),
    row({
      id: "mock-oi-002",
      orderId: MOCK_DEMO_ORDER_ID,
      storeProductId: "mock-sp-002",
      period1Sales: "60.0000",
      period2Sales: "55.0000",
      period3Sales: "58.0000",
      previousYearSales: "52.0000",
      highestSoldQty: "60.0000",
      bookStockQty: "20.0000",
      receivedNotPostedQty: "0.0000",
      futureDeliveryTotalQty: "15.0000",
      forecastSalesQty: "18.0000",
      shortageQty: "0.0000",
      projectedFinalStockQty: "17.0000",
      suggestedOrderQty: "43.0000",
      finalOrderQty: "43.0000",
      priceStatus: "check_missing_price",
      cheapestSupplierId: null,
      cheapestNetPrice: null,
      estimatedLineCost: null,
      calculationBreakdown: [],
      warning: "SP: missing net price",
    }),
    row({
      id: "mock-oi-003",
      orderId: MOCK_DEMO_ORDER_ID,
      storeProductId: "mock-sp-003",
      period1Sales: "80.0000",
      period2Sales: "75.0000",
      period3Sales: "78.0000",
      previousYearSales: "70.0000",
      highestSoldQty: "80.0000",
      bookStockQty: "30.0000",
      receivedNotPostedQty: "5.0000",
      futureDeliveryTotalQty: "0.0000",
      forecastSalesQty: "25.0000",
      shortageQty: "2.0000",
      projectedFinalStockQty: "8.0000",
      suggestedOrderQty: "72.0000",
      finalOrderQty: "72.0000",
      priceStatus: "complete",
      cheapestSupplierId: MOCK_MM_ID,
      cheapestNetPrice: "0.9500",
      estimatedLineCost: "68.4000",
      calculationBreakdown: [],
      warning: null,
    }),
  ];

  const orderItemSupplierPrices: Array<{
    id: string;
    orderItemId: string;
    supplierId: string;
    supplierCode: string | null;
    netPrice: string | null;
    priceValidationStatus: string;
    isCheapest: boolean;
    failureReason: string | null;
  }> = [
    {
      id: "mock-oisp-001",
      orderItemId: "mock-oi-001",
      supplierId: MOCK_MM_ID,
      supplierCode: "MM1001",
      netPrice: "1.9200",
      priceValidationStatus: "valid",
      isCheapest: false,
      failureReason: null,
    },
    {
      id: "mock-oisp-002",
      orderItemId: "mock-oi-001",
      supplierId: MOCK_SP_ID,
      supplierCode: "SP1001",
      netPrice: "1.8500",
      priceValidationStatus: "valid",
      isCheapest: true,
      failureReason: null,
    },
    {
      id: "mock-oisp-003",
      orderItemId: "mock-oi-002",
      supplierId: MOCK_MM_ID,
      supplierCode: null,
      netPrice: null,
      priceValidationStatus: "missing_code",
      isCheapest: false,
      failureReason: "MM: missing supplier product code mapping",
    },
    {
      id: "mock-oisp-004",
      orderItemId: "mock-oi-003",
      supplierId: MOCK_MM_ID,
      supplierCode: "MM1003",
      netPrice: "0.9500",
      priceValidationStatus: "valid",
      isCheapest: true,
      failureReason: null,
    },
  ];

  const orderPriceSuppliers = [
    { orderId: MOCK_DEMO_ORDER_ID, supplierId: MOCK_MM_ID },
    { orderId: MOCK_DEMO_ORDER_ID, supplierId: MOCK_SP_ID },
  ];

  return {
    stores,
    suppliers,
    products,
    storeProducts,
    barcodes,
    supplierProducts,
    orders,
    orderItems,
    orderItemSupplierPrices,
    orderPriceSuppliers,
    orderSalesPeriods: [] as Array<typeof schema.orderSalesPeriods.$inferSelect>,
  };
}

type MockState = ReturnType<typeof seedState>;

const globalKey = "__mieszkoMockState__";

function getState(): MockState {
  const g = globalThis as typeof globalThis & { [globalKey]?: MockState };
  if (!g[globalKey]) {
    g[globalKey] = seedState();
  }
  return g[globalKey]!;
}

export const storeRepository = {
  async list() {
    return [...getState().stores].sort((a, b) => a.name.localeCompare(b.name));
  },
  async getById(id: string) {
    return getState().stores.find((s) => s.id === id) ?? null;
  },
  async create(data: typeof schema.stores.$inferInsert) {
    const store = row({
      id: randomUUID(),
      name: data.name,
      code: data.code,
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().stores.push(store);
    return store;
  },
  async update(id: string, data: Partial<typeof schema.stores.$inferInsert>) {
    const store = getState().stores.find((s) => s.id === id);
    if (!store) throw new Error("Store not found");
    Object.assign(store, data, { updatedAt: now() });
    return store;
  },
};

export const supplierRepository = {
  async list() {
    return [...getState().suppliers].sort(
      (a, b) => a.priceTiePriority - b.priceTiePriority,
    );
  },
  async getActive() {
    return (await supplierRepository.list()).filter((s) => s.isActive);
  },
  async create(data: typeof schema.suppliers.$inferInsert) {
    const supplier = row({
      id: randomUUID(),
      name: data.name,
      code: data.code,
      priceTiePriority: data.priceTiePriority ?? 0,
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().suppliers.push(supplier);
    return supplier;
  },
  async update(id: string, data: Partial<typeof schema.suppliers.$inferInsert>) {
    const supplier = getState().suppliers.find((s) => s.id === id);
    if (!supplier) throw new Error("Supplier not found");
    Object.assign(supplier, data, { updatedAt: now() });
    return supplier;
  },
};

export const productRepository = {
  async list(filters?: {
    storeId?: string;
    department?: string;
    isActive?: boolean;
  }) {
    const state = getState();
    return state.storeProducts
      .map((sp) => ({
        storeProduct: sp,
        product: state.products.find((p) => p.id === sp.productId)!,
        store: state.stores.find((s) => s.id === sp.storeId)!,
      }))
      .filter(({ storeProduct, product }) => {
        if (filters?.storeId && storeProduct.storeId !== filters.storeId) return false;
        if (filters?.department && product.department !== filters.department) return false;
        if (filters?.isActive !== undefined) {
          if (product.isActive !== filters.isActive) return false;
          if (storeProduct.isActive !== filters.isActive) return false;
        }
        return true;
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  },
  async createProduct(data: typeof schema.products.$inferInsert) {
    const product = row({
      id: randomUUID(),
      name: data.name,
      department: data.department,
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().products.push(product);
    return product;
  },
  async updateProduct(id: string, data: Partial<typeof schema.products.$inferInsert>) {
    const product = getState().products.find((p) => p.id === id);
    if (!product) throw new Error("Product not found");
    Object.assign(product, data, { updatedAt: now() });
    return product;
  },
  async addStoreProduct(data: typeof schema.storeProducts.$inferInsert) {
    const sp = row({
      id: randomUUID(),
      storeId: data.storeId,
      productId: data.productId,
      storeProductCode: data.storeProductCode,
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().storeProducts.push(sp);
    return sp;
  },
  async addBarcode(data: typeof schema.productBarcodes.$inferInsert) {
    const bc = row({
      id: randomUUID(),
      productId: data.productId,
      barcode: data.barcode,
      createdAt: now(),
    });
    getState().barcodes.push(bc);
    return bc;
  },
  async addSupplierProduct(data: typeof schema.supplierProducts.$inferInsert) {
    const sp = row({
      id: randomUUID(),
      productId: data.productId,
      supplierId: data.supplierId,
      supplierCode: data.supplierCode,
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().supplierProducts.push(sp);
    return sp;
  },
  async getBarcodes(productId: string) {
    return getState().barcodes.filter((b) => b.productId === productId);
  },
  async getSupplierProducts(productId: string) {
    const state = getState();
    return state.supplierProducts
      .filter((sp) => sp.productId === productId)
      .map((supplierProduct) => ({
        supplierProduct,
        supplier: state.suppliers.find((s) => s.id === supplierProduct.supplierId)!,
      }));
  },
  async findStoreProductByCode(storeId: string, code: string) {
    return (
      getState().storeProducts.find(
        (sp) => sp.storeId === storeId && sp.storeProductCode === code,
      ) ?? null
    );
  },
  async findStoreProductByBarcode(storeId: string, barcode: string) {
    const state = getState();
    const bc = state.barcodes.find((b) => b.barcode === barcode);
    if (!bc) return null;
    return (
      state.storeProducts.find(
        (sp) => sp.storeId === storeId && sp.productId === bc.productId,
      ) ?? null
    );
  },
  async findStoreProductBySupplierCode(
    storeId: string,
    supplierId: string,
    supplierCode: string,
  ) {
    const state = getState();
    const mapping = state.supplierProducts.find(
      (sp) => sp.supplierId === supplierId && sp.supplierCode === supplierCode,
    );
    if (!mapping) return null;
    return (
      state.storeProducts.find(
        (sp) => sp.storeId === storeId && sp.productId === mapping.productId,
      ) ?? null
    );
  },
  async getDepartments() {
    return [...new Set(getState().products.map((p) => p.department))].sort();
  },
};

export const dailySalesRepository = {
  async upsertSale(_data: typeof schema.dailySales.$inferInsert) {
    return row({ id: randomUUID() });
  },
  async sumSalesInPeriod() {
    return "0";
  },
  async getSalesForProduct() {
    return [];
  },
};

export const supplierPriceRepository = {
  async createImport(data: typeof schema.supplierPriceImports.$inferInsert) {
    return row({ id: randomUUID(), ...data, importedAt: now() });
  },
  async insertPrices() {
    return [];
  },
  async getLatestPrice() {
    return null;
  },
  async findSupplierProduct(supplierId: string, supplierCode: string) {
    return (
      getState().supplierProducts.find(
        (sp) => sp.supplierId === supplierId && sp.supplierCode === supplierCode,
      ) ?? null
    );
  },
};

export const orderRepository = {
  async list() {
    const state = getState();
    return state.orders
      .map((order) => ({
        order,
        store: state.stores.find((s) => s.id === order.storeId)!,
      }))
      .sort((a, b) => b.order.createdAt.getTime() - a.order.createdAt.getTime());
  },
  async getById(orderId: string) {
    return getState().orders.find((o) => o.id === orderId) ?? null;
  },
  async create(data: typeof schema.orders.$inferInsert) {
    const order = row({
      id: randomUUID(),
      storeId: data.storeId,
      bookStockDate: data.bookStockDate,
      clientDeliveryDate: data.clientDeliveryDate,
      departmentFilters: data.departmentFilters ?? [],
      notes: data.notes ?? null,
      status: data.status ?? "draft",
      createdAt: now(),
      updatedAt: now(),
    });
    getState().orders.unshift(order);
    return order;
  },
  async update(orderId: string, data: Partial<typeof schema.orders.$inferInsert>) {
    const order = getState().orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found");
    Object.assign(order, data, { updatedAt: now() });
    return order;
  },
  async replacePeriods(
    orderId: string,
    periods: Array<typeof schema.orderSalesPeriods.$inferInsert>,
  ) {
    const state = getState();
    state.orderSalesPeriods = state.orderSalesPeriods.filter(
      (p) => p.orderId !== orderId,
    );
    state.orderSalesPeriods.push(
      ...periods.map((p) =>
        row({
          id: randomUUID(),
          orderId: p.orderId,
          periodKey: p.periodKey,
          startDate: p.startDate,
          endDate: p.endDate,
        }),
      ),
    );
  },
  async replacePriceSuppliers(orderId: string, supplierIds: string[]) {
    const state = getState();
    state.orderPriceSuppliers = state.orderPriceSuppliers.filter(
      (p) => p.orderId !== orderId,
    );
    state.orderPriceSuppliers.push(
      ...supplierIds.map((supplierId) => ({ orderId, supplierId })),
    );
  },
  async getPeriods(orderId: string) {
    return getState().orderSalesPeriods.filter((p) => p.orderId === orderId);
  },
  async getSelectedSuppliers(orderId: string) {
    const state = getState();
    return state.orderPriceSuppliers
      .filter((p) => p.orderId === orderId)
      .map(({ supplierId }) => ({
        supplier: state.suppliers.find((s) => s.id === supplierId)!,
      }))
      .sort((a, b) => a.supplier.priceTiePriority - b.supplier.priceTiePriority);
  },
  async createUpload(data: typeof schema.orderUploads.$inferInsert) {
    return row({ id: randomUUID(), ...data, createdAt: now() });
  },
  async createStockEvent(data: typeof schema.orderStockEvents.$inferInsert) {
    return row({ id: randomUUID(), ...data, createdAt: now() });
  },
  async createStockEventItems(
    rows: Array<typeof schema.orderStockEventItems.$inferInsert>,
  ) {
    return rows.map((r) => row({ id: randomUUID(), ...r }));
  },
  async getStoreProductsForOrder(storeId: string, departments: string[]) {
    return productRepository.list({
      storeId,
      department: departments[0],
      isActive: true,
    });
  },
  async getStockEvents() {
    return [];
  },
  async clearCalculatedItems(orderId: string) {
    const state = getState();
    const removed = state.orderItems.filter((i) => i.orderId === orderId);
    state.orderItems = state.orderItems.filter((i) => i.orderId !== orderId);
    const removedIds = new Set(removed.map((i) => i.id));
    state.orderItemSupplierPrices = state.orderItemSupplierPrices.filter(
      (p) => !removedIds.has(p.orderItemId),
    );
  },
  async insertOrderItems(rows: Array<typeof schema.orderItems.$inferInsert>) {
    const created = rows.map((r) =>
      row({ id: randomUUID(), ...r }),
    ) as OrderItem[];
    getState().orderItems.push(...created);
    return created;
  },
  async insertItemSupplierPrices(
    rows: Array<typeof schema.orderItemSupplierPrices.$inferInsert>,
  ) {
    const created = rows.map((r) => ({
      id: randomUUID(),
      orderItemId: r.orderItemId,
      supplierId: r.supplierId,
      supplierCode: r.supplierCode ?? null,
      netPrice: r.netPrice ?? null,
      priceValidationStatus: r.priceValidationStatus,
      isCheapest: r.isCheapest ?? false,
      failureReason: r.failureReason ?? null,
    }));
    getState().orderItemSupplierPrices.push(...created);
    return created;
  },
  async getOrderItemsWithDetails(orderId: string) {
    const state = getState();
    return state.orderItems
      .filter((i) => i.orderId === orderId)
      .map((item) => ({
        item,
        storeProduct: state.storeProducts.find((sp) => sp.id === item.storeProductId)!,
        product: state.products.find(
          (p) =>
            p.id ===
            state.storeProducts.find((sp) => sp.id === item.storeProductId)?.productId,
        )!,
      }))
      .sort((a, b) =>
        a.storeProduct.storeProductCode.localeCompare(b.storeProduct.storeProductCode),
      );
  },
  async getItemSupplierPrices(orderId: string) {
    const state = getState();
    const itemIds = new Set(
      state.orderItems.filter((i) => i.orderId === orderId).map((i) => i.id),
    );
    return state.orderItemSupplierPrices
      .filter((p) => itemIds.has(p.orderItemId))
      .map((price) => ({
        price,
        supplier: state.suppliers.find((s) => s.id === price.supplierId)!,
      }));
  },
  async updateFinalQuantity(orderItemId: string, finalOrderQty: string) {
    const item = getState().orderItems.find((i) => i.id === orderItemId);
    if (!item) throw new Error("Order item not found");
    item.finalOrderQty = finalOrderQty;
    if (item.cheapestNetPrice) {
      const qty = Number(finalOrderQty);
      const price = Number(item.cheapestNetPrice);
      item.estimatedLineCost = (qty * price).toFixed(4);
    }
    return item;
  },
  async getOrderItem(orderItemId: string) {
    return getState().orderItems.find((i) => i.id === orderItemId) ?? null;
  },
  async simulateCalculate(orderId: string) {
    await orderRepository.clearCalculatedItems(orderId);
    const state = getState();
    const products = state.storeProducts.filter((sp) => {
      const order = state.orders.find((o) => o.id === orderId);
      return order && sp.storeId === order.storeId;
    });

    for (const sp of products.slice(0, 3)) {
      const product = state.products.find((p) => p.id === sp.productId)!;
      const [item] = await orderRepository.insertOrderItems([
        {
          orderId,
          storeProductId: sp.id,
          period1Sales: "50.0000",
          period2Sales: "48.0000",
          period3Sales: "52.0000",
          previousYearSales: "45.0000",
          highestSoldQty: "52.0000",
          bookStockQty: "20.0000",
          receivedNotPostedQty: "5.0000",
          futureDeliveryTotalQty: "0.0000",
          forecastSalesQty: "15.0000",
          shortageQty: "0.0000",
          projectedFinalStockQty: "10.0000",
          suggestedOrderQty: "42.0000",
          finalOrderQty: "42.0000",
          priceStatus: "complete",
          cheapestSupplierId: MOCK_SP_ID,
          cheapestNetPrice: "2.1000",
          estimatedLineCost: "88.2000",
          calculationBreakdown: [],
          warning: null,
        },
      ]);
      await orderRepository.insertItemSupplierPrices([
        {
          orderItemId: item.id,
          supplierId: MOCK_MM_ID,
          supplierCode: "MM-X",
          netPrice: "2.2000",
          priceValidationStatus: "valid",
          isCheapest: false,
          failureReason: null,
        },
        {
          orderItemId: item.id,
          supplierId: MOCK_SP_ID,
          supplierCode: "SP-X",
          netPrice: "2.1000",
          priceValidationStatus: "valid",
          isCheapest: true,
          failureReason: null,
        },
      ]);
      void product;
    }

    await orderRepository.update(orderId, { status: "calculated" });
  },
};
