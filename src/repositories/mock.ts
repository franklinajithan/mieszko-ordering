import "server-only";
import { randomUUID } from "crypto";
import type * as schema from "@/db/schema";

type Store = typeof schema.stores.$inferSelect;
type Supplier = typeof schema.suppliers.$inferSelect;
type Department = typeof schema.departments.$inferSelect;
type Product = typeof schema.products.$inferSelect;
type StoreProduct = typeof schema.storeProducts.$inferSelect;
type Order = typeof schema.orders.$inferSelect;
type OrderItem = typeof schema.orderItems.$inferSelect;
type Barcode = typeof schema.productBarcodes.$inferSelect;
type SupplierProduct = typeof schema.supplierProducts.$inferSelect;

const now = () => new Date();

let nextId = 1000;
function genId() {
  return ++nextId;
}

const MOCK_STORE_ID = 1;
const MOCK_MM_ID = 1;
const MOCK_SP_ID = 2;
const MOCK_WAB_ID = 3;
export const MOCK_DEMO_ORDER_ID = 1;

function row<T extends Record<string, unknown>>(value: T): T {
  return value;
}

function seedState() {
  const stores: Store[] = [
    row({
      id: 1,
      name: "Sudbury",
      code: "SBH",
      erpType: "glopos",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 2,
      name: "Hounslow",
      code: "HNS",
      erpType: "msp",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),

    row({
      id: 3,
      name: "Perivale",
      code: "PVL",
      erpType: "msp",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 4,
      name: "Hayes",
      code: "HYS",
      erpType: "msp",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 5,
      name: "Gravesend",
      code: "GRV",
      erpType: "msp",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 6,
      name: "Streatham",
      code: "STR",
      erpType: "msp",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 7,
      name: "Eastham",
      code: "EAS",
      erpType: "glopos",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 8,
      name: "Watford",
      code: "WTF",
      erpType: "msp",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 9,
      name: "Mitcham",
      code: "MIT",
      erpType: "glopos",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const suppliers: Supplier[] = [
    row({
      id: MOCK_MM_ID,
      name: "Master Media",
      code: "MM",
      priceTiePriority: 1,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: MOCK_SP_ID,
      name: "Spizarnia",
      code: "SP",
      priceTiePriority: 2,
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: MOCK_WAB_ID,
      name: "Wabar",
      code: "WAB",
      priceTiePriority: 3,
      isActive: false,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const departments: Department[] = [
    row({
      id: "mock-dept-dairy",
      name: "Dairy",
      code: "DAIRY",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: "mock-dept-cheese",
      name: "Cheese",
      code: "CHEESE",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const products: Product[] = [
    row({
      id: 1,
      name: "Fresh Milk 2L",
      department: "Dairy",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 2,
      name: "Cheddar Block 400g",
      department: "Cheese",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 3,
      name: "Natural Yogurt 500g",
      department: "Dairy",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const storeProducts: StoreProduct[] = [
    row({
      id: 1,
      storeId: MOCK_STORE_ID,
      productId: 1,
      storeProductCode: "1001",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 2,
      storeId: MOCK_STORE_ID,
      productId: 2,
      storeProductCode: "2001",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 3,
      storeId: MOCK_STORE_ID,
      productId: 3,
      storeProductCode: "1002",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
  ];

  const barcodes: Barcode[] = [
    row({
      id: 1,
      productId: 1,
      barcode: "5012345678901",
      createdAt: now(),
    }),
  ];

  const supplierProducts: SupplierProduct[] = [
    row({
      id: 1,
      productId: 1,
      supplierId: MOCK_MM_ID,
      supplierCode: "MM1001",
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    }),
    row({
      id: 2,
      productId: 1,
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
      id: 1,
      orderId: MOCK_DEMO_ORDER_ID,
      storeProductId: 1,
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
      id: 2,
      orderId: MOCK_DEMO_ORDER_ID,
      storeProductId: 2,
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
      id: 3,
      orderId: MOCK_DEMO_ORDER_ID,
      storeProductId: 3,
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
    id: number;
    orderItemId: number;
    supplierId: number;
    supplierCode: string | null;
    netPrice: string | null;
    priceValidationStatus: string;
    isCheapest: boolean;
    failureReason: string | null;
  }> = [
    {
      id: 1,
      orderItemId: 1,
      supplierId: MOCK_MM_ID,
      supplierCode: "MM1001",
      netPrice: "1.9200",
      priceValidationStatus: "valid",
      isCheapest: false,
      failureReason: null,
    },
    {
      id: 2,
      orderItemId: 1,
      supplierId: MOCK_SP_ID,
      supplierCode: "SP1001",
      netPrice: "1.8500",
      priceValidationStatus: "valid",
      isCheapest: true,
      failureReason: null,
    },
    {
      id: 3,
      orderItemId: 2,
      supplierId: MOCK_MM_ID,
      supplierCode: null,
      netPrice: null,
      priceValidationStatus: "missing_code",
      isCheapest: false,
      failureReason: "MM: missing supplier product code mapping",
    },
    {
      id: 4,
      orderItemId: 3,
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
    departments,
    products,
    storeProducts,
    barcodes,
    supplierProducts,
    orders,
    orderItems,
    orderItemSupplierPrices,
    orderPriceSuppliers,
    orderSalesPeriods: [] as Array<typeof schema.orderSalesPeriods.$inferSelect>,
    bookStockImports: [] as Array<typeof schema.bookStockImports.$inferSelect>,
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
  async getById(id: number) {
    return getState().stores.find((s) => s.id === id) ?? null;
  },
  async create(data: typeof schema.stores.$inferInsert) {
    const store = row({
      id: genId(),
      name: data.name,
      code: data.code,
      erpType: data.erpType ?? "msp",
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().stores.push(store);
    return store;
  },
  async update(id: number, data: Partial<typeof schema.stores.$inferInsert>) {
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
      id: genId(),
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
  async update(id: number, data: Partial<typeof schema.suppliers.$inferInsert>) {
    const supplier = getState().suppliers.find((s) => s.id === id);
    if (!supplier) throw new Error("Supplier not found");
    Object.assign(supplier, data, { updatedAt: now() });
    return supplier;
  },
};

export const departmentRepository = {
  async list() {
    return [...getState().departments].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  },
  async getById(id: string) {
    return getState().departments.find((d) => d.id === id) ?? null;
  },
  async getByName(name: string) {
    return getState().departments.find((d) => d.name === name) ?? null;
  },
  async create(data: typeof schema.departments.$inferInsert) {
    const department = row({
      id: randomUUID(),
      name: data.name,
      code: data.code ?? null,
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().departments.push(department);
    return department;
  },
  async update(
    id: string,
    data: Partial<typeof schema.departments.$inferInsert>,
  ) {
    const state = getState();
    const department = state.departments.find((d) => d.id === id);
    if (!department) return null;

    const previousName = department.name;
    Object.assign(department, data, { updatedAt: now() });

    if (data.name && data.name !== previousName) {
      for (const product of state.products) {
        if (product.department === previousName) {
          product.department = data.name;
          product.updatedAt = now();
        }
      }
    }

    return department;
  },
  async listActiveNames() {
    const active = getState()
      .departments.filter((d) => d.isActive)
      .map((d) => d.name)
      .sort();
    if (active.length > 0) return active;
    return [...new Set(getState().products.map((p) => p.department))].sort();
  },
};

export const productRepository = {
  filterListItems(
    filters?: {
      storeId?: number;
      department?: string;
      isActive?: boolean;
      search?: string;
    },
  ) {
    const state = getState();
    const search = filters?.search?.trim().toLowerCase();
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
        if (search) {
          const haystack =
            `${product.name} ${storeProduct.storeProductCode}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const byName = a.product.name.localeCompare(b.product.name, undefined, {
          sensitivity: "base",
        });
        if (byName !== 0) return byName;
        return a.storeProduct.storeProductCode.localeCompare(
          b.storeProduct.storeProductCode,
        );
      });
  },

  async list(filters?: {
    storeId?: number;
    department?: string;
    isActive?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const rows = productRepository.filterListItems(filters);
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit;
    if (limit === undefined) return rows;
    return rows.slice(offset, offset + limit);
  },

  async count(filters?: {
    storeId?: number;
    department?: string;
    isActive?: boolean;
    search?: string;
  }) {
    return productRepository.filterListItems(filters).length;
  },

  async getDuplicateProductNameKeys(filters?: {
    storeId?: number;
    department?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const counts = new Map<string, number>();
    for (const { product } of productRepository.filterListItems(filters)) {
      const key = product.name.trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key);
  },

  async createProduct(data: typeof schema.products.$inferInsert) {
    const product = row({
      id: genId(),
      name: data.name,
      department: data.department,
      isActive: data.isActive ?? true,
      createdAt: now(),
      updatedAt: now(),
    });
    getState().products.push(product);
    return product;
  },
  async getById(id: number) {
    return getState().products.find((product) => product.id === id) ?? null;
  },
  async updateProduct(id: number, data: Partial<typeof schema.products.$inferInsert>) {
    const product = getState().products.find((p) => p.id === id);
    if (!product) throw new Error("Product not found");
    Object.assign(product, data, { updatedAt: now() });
    return product;
  },
  async addStoreProduct(data: typeof schema.storeProducts.$inferInsert) {
    const existing = getState().storeProducts.find(
      (sp) =>
        sp.storeId === data.storeId &&
        sp.storeProductCode === data.storeProductCode,
    );
    if (existing) {
      existing.productId = data.productId;
      existing.isActive = data.isActive ?? true;
      existing.updatedAt = now();
      return existing;
    }
    const sp = row({
      id: genId(),
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
  async upsertStoreProduct(data: typeof schema.storeProducts.$inferInsert) {
    return productRepository.addStoreProduct(data);
  },
  async addBarcode(data: typeof schema.productBarcodes.$inferInsert) {
    const bc = row({
      id: genId(),
      productId: data.productId,
      barcode: data.barcode,
      createdAt: now(),
    });
    getState().barcodes.push(bc);
    return bc;
  },
  async addBarcodeIfAbsent(data: typeof schema.productBarcodes.$inferInsert) {
    const existing = getState().barcodes.find((b) => b.barcode === data.barcode);
    if (existing) return null;
    return productRepository.addBarcode(data);
  },
  async addSupplierProduct(data: typeof schema.supplierProducts.$inferInsert) {
    const sp = row({
      id: genId(),
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
  async getBarcodes(productId: number) {
    return getState().barcodes.filter((b) => b.productId === productId);
  },
  async getSupplierProducts(productId: number) {
    const state = getState();
    return state.supplierProducts
      .filter((sp) => sp.productId === productId)
      .map((supplierProduct) => ({
        supplierProduct,
        supplier: state.suppliers.find((s) => s.id === supplierProduct.supplierId)!,
      }));
  },
  async findStoreProductByCode(storeId: number, code: string) {
    return (
      getState().storeProducts.find(
        (sp) => sp.storeId === storeId && sp.storeProductCode === code,
      ) ?? null
    );
  },
  async findMspStoreProductByCode(code: string) {
    const state = getState();
    const storeProduct = state.storeProducts.find((sp) => {
      const store = state.stores.find((s) => s.id === sp.storeId);
      return store?.erpType === "msp" && sp.storeProductCode === code;
    });
    if (!storeProduct) return null;
    const product = state.products.find((p) => p.id === storeProduct.productId)!;
    return { storeProduct, product };
  },
  async findStoreProductByBarcode(storeId: number, barcode: string) {
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
    storeId: number,
    supplierId: number,
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
  async getDepartments(storeId?: number) {
    const state = getState();
    const productIds = storeId
      ? new Set(
          state.storeProducts
            .filter((sp) => sp.storeId === storeId)
            .map((sp) => sp.productId),
        )
      : null;
    return [
      ...new Set(
        state.products
          .filter((p) => !productIds || productIds.has(p.id))
          .map((p) => p.department),
      ),
    ].sort();
  },
};

export const dailySalesRepository = {
  async upsertSale(_data: typeof schema.dailySales.$inferInsert) {
    return row({ id: genId() });
  },
  async sumSalesInPeriod() {
    return "0";
  },
  async getSalesForProduct() {
    return [];
  },
};

export const bookStockRepository = {
  async createImport(data: typeof schema.bookStockImports.$inferInsert) {
    return row({ id: genId(), ...data, importedAt: now() });
  },
  async insertItems() {
    return [];
  },
  async getImportById(importId: number) {
    return getState().bookStockImports.find((i) => i.id === importId) ?? null;
  },
  async getLatestForStore(storeId: number) {
    return (
      getState()
        .bookStockImports.filter((i) => i.storeId === storeId)
        .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime())[0] ?? null
    );
  },
  async listForStore(storeId: number) {
    return getState()
      .bookStockImports.filter((i) => i.storeId === storeId)
      .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime());
  },
  async getItems() {
    return [];
  },
  async countItems() {
    return 0;
  },
};

export const supplierPriceRepository = {
  async createImport(data: typeof schema.supplierPriceImports.$inferInsert) {
    return row({ id: genId(), ...data, importedAt: now() });
  },
  async insertPrices() {
    return [];
  },
  async getLatestPrice() {
    return null;
  },
  async findSupplierProduct(supplierId: number, supplierCode: string) {
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
  async getById(orderId: number) {
    return getState().orders.find((o) => o.id === orderId) ?? null;
  },
  async create(data: typeof schema.orders.$inferInsert) {
    const order = row({
      id: genId(),
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
  async update(orderId: number, data: Partial<typeof schema.orders.$inferInsert>) {
    const order = getState().orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found");
    Object.assign(order, data, { updatedAt: now() });
    return order;
  },
  async replacePeriods(
    orderId: number,
    periods: Array<typeof schema.orderSalesPeriods.$inferInsert>,
  ) {
    const state = getState();
    state.orderSalesPeriods = state.orderSalesPeriods.filter(
      (p) => p.orderId !== orderId,
    );
    state.orderSalesPeriods.push(
      ...periods.map((p) =>
        row({
          id: genId(),
          orderId: p.orderId,
          periodKey: p.periodKey,
          startDate: p.startDate,
          endDate: p.endDate,
        }),
      ),
    );
  },
  async replacePriceSuppliers(orderId: number, supplierIds: number[]) {
    const state = getState();
    state.orderPriceSuppliers = state.orderPriceSuppliers.filter(
      (p) => p.orderId !== orderId,
    );
    state.orderPriceSuppliers.push(
      ...supplierIds.map((supplierId) => ({ orderId, supplierId })),
    );
  },
  async getPeriods(orderId: number) {
    return getState().orderSalesPeriods.filter((p) => p.orderId === orderId);
  },
  async getSelectedSuppliers(orderId: number) {
    const state = getState();
    return state.orderPriceSuppliers
      .filter((p) => p.orderId === orderId)
      .map(({ supplierId }) => ({
        supplier: state.suppliers.find((s) => s.id === supplierId)!,
      }))
      .sort((a, b) => a.supplier.priceTiePriority - b.supplier.priceTiePriority);
  },
  async createUpload(data: typeof schema.orderUploads.$inferInsert) {
    return row({ id: genId(), ...data, createdAt: now() });
  },
  async createStockEvent(data: typeof schema.orderStockEvents.$inferInsert) {
    return row({ id: genId(), ...data, createdAt: now() });
  },
  async createStockEventItems(
    rows: Array<typeof schema.orderStockEventItems.$inferInsert>,
  ) {
    return rows.map((r) => row({ id: genId(), ...r }));
  },
  async getStoreProductsForOrder(storeId: number, departments: string[]) {
    return productRepository.list({
      storeId,
      department: departments[0],
      isActive: true,
    });
  },
  async getStockEvents() {
    return [];
  },
  async clearBookStockEvents(_orderId: number) {
    return;
  },
  async clearCalculatedItems(orderId: number) {
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
      row({ id: genId(), ...r }),
    ) as OrderItem[];
    getState().orderItems.push(...created);
    return created;
  },
  async insertItemSupplierPrices(
    rows: Array<typeof schema.orderItemSupplierPrices.$inferInsert>,
  ) {
    const created = rows.map((r) => ({
      id: genId(),
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
  async getOrderItemsWithDetails(orderId: number) {
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
  async getItemSupplierPrices(orderId: number) {
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
  async updateFinalQuantity(orderItemId: number, finalOrderQty: string) {
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
  async getOrderItem(orderItemId: number) {
    return getState().orderItems.find((i) => i.id === orderItemId) ?? null;
  },
  async simulateCalculate(orderId: number) {
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
