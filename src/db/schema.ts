import {

  boolean,

  date,

  index,

  integer,

  jsonb,

  numeric,

  pgTable,

  primaryKey,

  text,

  timestamp,

  unique,

  uuid,

  varchar,

} from "drizzle-orm/pg-core";

import { relations, sql } from "drizzle-orm";



export const stores = pgTable("stores", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  name: varchar("name", { length: 255 }).notNull(),

  code: varchar("code", { length: 50 }).notNull().unique(),

  erpType: varchar("erp_type", { length: 50 }).notNull().default("msp"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const suppliers = pgTable("suppliers", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  name: varchar("name", { length: 255 }).notNull(),

  code: varchar("code", { length: 50 }).notNull().unique(),

  priceTiePriority: integer("price_tie_priority").notNull().default(0),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  code: varchar("code", { length: 50 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});


export const products = pgTable("products", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  name: varchar("name", { length: 500 }).notNull(),

  department: varchar("department", { length: 100 }).notNull(),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const storeProducts = pgTable(

  "store_products",

  {

    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

    storeId: integer("store_id")

      .notNull()

      .references(() => stores.id),

    productId: integer("product_id")

      .notNull()

      .references(() => products.id),

    storeProductCode: varchar("store_product_code", { length: 100 }).notNull(),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })

      .notNull()

      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })

      .notNull()

      .defaultNow(),

  },

  (t) => [
    unique("store_products_store_code_unique").on(t.storeId, t.storeProductCode),
    index("store_products_store_id_idx").on(t.storeId),
  ],

);



export const productBarcodes = pgTable("product_barcodes", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  productId: integer("product_id")

    .notNull()

    .references(() => products.id),

  barcode: varchar("barcode", { length: 100 }).notNull().unique(),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const supplierProducts = pgTable(

  "supplier_products",

  {

    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

    productId: integer("product_id")

      .notNull()

      .references(() => products.id),

    supplierId: integer("supplier_id")

      .notNull()

      .references(() => suppliers.id),

    supplierCode: varchar("supplier_code", { length: 100 }).notNull(),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })

      .notNull()

      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })

      .notNull()

      .defaultNow(),

  },

  (t) => [

    unique("supplier_products_supplier_code_unique").on(

      t.supplierId,

      t.supplierCode,

    ),

  ],

);



export const dailySales = pgTable(

  "daily_sales",

  {

    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

    storeProductId: integer("store_product_id")

      .notNull()

      .references(() => storeProducts.id),

    salesDate: date("sales_date").notNull(),

    soldQty: numeric("sold_qty", { precision: 18, scale: 4 }).notNull(),

    rtcQty: numeric("rtc_qty", { precision: 18, scale: 4 }),

    promoQty: numeric("promo_qty", { precision: 18, scale: 4 }),

    createdAt: timestamp("created_at", { withTimezone: true })

      .notNull()

      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })

      .notNull()

      .defaultNow(),

  },

  (t) => [

    unique("daily_sales_store_product_date_unique").on(

      t.storeProductId,

      t.salesDate,

    ),

  ],

);



export const supplierPriceImports = pgTable("supplier_price_imports", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  supplierId: integer("supplier_id")

    .notNull()

    .references(() => suppliers.id),

  effectiveDate: date("effective_date").notNull(),

  fileName: varchar("file_name", { length: 500 }),

  importedAt: timestamp("imported_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const supplierPrices = pgTable("supplier_prices", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  importId: integer("import_id")

    .notNull()

    .references(() => supplierPriceImports.id),

  supplierId: integer("supplier_id")

    .notNull()

    .references(() => suppliers.id),

  supplierProductId: integer("supplier_product_id").references(

    () => supplierProducts.id,

  ),

  supplierCode: varchar("supplier_code", { length: 100 }).notNull(),

  netPrice: numeric("net_price", { precision: 18, scale: 4 }).notNull(),

  effectiveDate: date("effective_date").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const bookStockImports = pgTable("book_stock_imports", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  storeId: integer("store_id")

    .notNull()

    .references(() => stores.id),

  bookStockDate: date("book_stock_date").notNull(),

  fileName: varchar("file_name", { length: 500 }),

  referenceColumn: varchar("reference_column", { length: 255 }).notNull(),

  quantityColumn: varchar("quantity_column", { length: 255 }).notNull(),

  importedAt: timestamp("imported_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const bookStockItems = pgTable("book_stock_items", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  importId: integer("import_id")

    .notNull()

    .references(() => bookStockImports.id, { onDelete: "cascade" }),

  storeProductId: integer("store_product_id")

    .notNull()

    .references(() => storeProducts.id),

  storeProductCode: varchar("store_product_code", { length: 100 }).notNull(),

  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),

});



export const rtcImports = pgTable("rtc_imports", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  storeId: integer("store_id")
    .notNull()
    .references(() => stores.id),
  rtcDate: date("rtc_date").notNull(),
  fileName: varchar("file_name", { length: 500 }),
  referenceColumn: varchar("reference_column", { length: 255 }).notNull(),
  quantityColumn: varchar("quantity_column", { length: 255 }).notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const rtcItems = pgTable("rtc_items", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  importId: integer("import_id")
    .notNull()
    .references(() => rtcImports.id, { onDelete: "cascade" }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => storeProducts.id),
  storeProductCode: varchar("store_product_code", { length: 100 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
});

export const wastageImports = pgTable("wastage_imports", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  storeId: integer("store_id")
    .notNull()
    .references(() => stores.id),
  wastageDate: date("wastage_date").notNull(),
  fileName: varchar("file_name", { length: 500 }),
  referenceColumn: varchar("reference_column", { length: 255 }).notNull(),
  quantityColumn: varchar("quantity_column", { length: 255 }).notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wastageItems = pgTable("wastage_items", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  importId: integer("import_id")
    .notNull()
    .references(() => wastageImports.id, { onDelete: "cascade" }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => storeProducts.id),
  storeProductCode: varchar("store_product_code", { length: 100 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
});



export const orders = pgTable("orders", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  storeId: integer("store_id")

    .notNull()

    .references(() => stores.id),

  bookStockDate: date("book_stock_date").notNull(),

  clientDeliveryDate: date("client_delivery_date").notNull(),

  departmentFilters: text("department_filters")

    .array()

    .notNull()

    .default(sql`'{}'::text[]`),

  notes: text("notes"),

  status: varchar("status", { length: 50 }).notNull().default("draft"),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const orderSalesPeriods = pgTable(

  "order_sales_periods",

  {

    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

    orderId: integer("order_id")

      .notNull()

      .references(() => orders.id, { onDelete: "cascade" }),

    periodKey: varchar("period_key", { length: 50 }).notNull(),

    startDate: date("start_date").notNull(),

    endDate: date("end_date").notNull(),

  },

  (t) => [unique("order_sales_periods_order_key_unique").on(t.orderId, t.periodKey)],

);



export const orderPriceSuppliers = pgTable(

  "order_price_suppliers",

  {

    orderId: integer("order_id")

      .notNull()

      .references(() => orders.id, { onDelete: "cascade" }),

    supplierId: integer("supplier_id")

      .notNull()

      .references(() => suppliers.id),

  },

  (t) => [primaryKey({ columns: [t.orderId, t.supplierId] })],

);



export const orderUploads = pgTable("order_uploads", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  orderId: integer("order_id")

    .notNull()

    .references(() => orders.id, { onDelete: "cascade" }),

  uploadType: varchar("upload_type", { length: 50 }).notNull(),

  fileName: varchar("file_name", { length: 500 }).notNull(),

  mappingType: varchar("mapping_type", { length: 50 }).notNull(),

  referenceColumn: varchar("reference_column", { length: 255 }).notNull(),

  quantityColumn: varchar("quantity_column", { length: 255 }).notNull(),

  supplierId: integer("supplier_id").references(() => suppliers.id),

  bookStockImportId: integer("book_stock_import_id").references(

    () => bookStockImports.id,

  ),

  deliveryDate: date("delivery_date"),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const orderStockEvents = pgTable("order_stock_events", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  orderId: integer("order_id")

    .notNull()

    .references(() => orders.id, { onDelete: "cascade" }),

  uploadId: integer("upload_id").references(() => orderUploads.id),

  eventType: varchar("event_type", { length: 50 }).notNull(),

  eventDate: date("event_date").notNull(),

  sortOrder: integer("sort_order").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



export const orderStockEventItems = pgTable("order_stock_event_items", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  eventId: integer("event_id")

    .notNull()

    .references(() => orderStockEvents.id, { onDelete: "cascade" }),

  storeProductId: integer("store_product_id")

    .notNull()

    .references(() => storeProducts.id),

  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),

});



export const orderItems = pgTable(

  "order_items",

  {

    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

    orderId: integer("order_id")

      .notNull()

      .references(() => orders.id, { onDelete: "cascade" }),

    storeProductId: integer("store_product_id")

      .notNull()

      .references(() => storeProducts.id),

    period1Sales: numeric("period_1_sales", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    period2Sales: numeric("period_2_sales", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    period3Sales: numeric("period_3_sales", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    previousYearSales: numeric("previous_year_sales", {

      precision: 18,

      scale: 4,

    })

      .notNull()

      .default("0"),

    highestSoldQty: numeric("highest_sold_qty", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    bookStockQty: numeric("book_stock_qty", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    receivedNotPostedQty: numeric("received_not_posted_qty", {

      precision: 18,

      scale: 4,

    })

      .notNull()

      .default("0"),

    futureDeliveryTotalQty: numeric("future_delivery_total_qty", {

      precision: 18,

      scale: 4,

    })

      .notNull()

      .default("0"),

    forecastSalesQty: numeric("forecast_sales_qty", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    shortageQty: numeric("shortage_qty", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    projectedFinalStockQty: numeric("projected_final_stock_qty", {

      precision: 18,

      scale: 4,

    })

      .notNull()

      .default("0"),

    suggestedOrderQty: numeric("suggested_order_qty", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    finalOrderQty: numeric("final_order_qty", { precision: 18, scale: 4 })

      .notNull()

      .default("0"),

    priceStatus: varchar("price_status", { length: 50 })

      .notNull()

      .default("pending"),

    cheapestSupplierId: integer("cheapest_supplier_id").references(

      () => suppliers.id,

    ),

    cheapestNetPrice: numeric("cheapest_net_price", { precision: 18, scale: 4 }),

    estimatedLineCost: numeric("estimated_line_cost", {

      precision: 18,

      scale: 4,

    }),

    calculationBreakdown: jsonb("calculation_breakdown"),

    warning: text("warning"),

  },

  (t) => [

    unique("order_items_order_store_product_unique").on(

      t.orderId,

      t.storeProductId,

    ),

  ],

);



export const orderItemSupplierPrices = pgTable(

  "order_item_supplier_prices",

  {

    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

    orderItemId: integer("order_item_id")

      .notNull()

      .references(() => orderItems.id, { onDelete: "cascade" }),

    supplierId: integer("supplier_id")

      .notNull()

      .references(() => suppliers.id),

    supplierCode: varchar("supplier_code", { length: 100 }),

    netPrice: numeric("net_price", { precision: 18, scale: 4 }),

    priceValidationStatus: varchar("price_validation_status", {

      length: 50,

    }).notNull(),

    isCheapest: boolean("is_cheapest").notNull().default(false),

    failureReason: text("failure_reason"),

  },

  (t) => [

    unique("order_item_supplier_prices_item_supplier_unique").on(

      t.orderItemId,

      t.supplierId,

    ),

  ],

);



export const storesRelations = relations(stores, ({ many }) => ({

  storeProducts: many(storeProducts),

  orders: many(orders),

}));



export const productsRelations = relations(products, ({ many }) => ({

  storeProducts: many(storeProducts),

  barcodes: many(productBarcodes),

  supplierProducts: many(supplierProducts),

}));



export const storeProductsRelations = relations(storeProducts, ({ one, many }) => ({

  store: one(stores, {

    fields: [storeProducts.storeId],

    references: [stores.id],

  }),

  product: one(products, {

    fields: [storeProducts.productId],

    references: [products.id],

  }),

  dailySales: many(dailySales),

}));



export const ordersRelations = relations(orders, ({ one, many }) => ({

  store: one(stores, {

    fields: [orders.storeId],

    references: [stores.id],

  }),

  salesPeriods: many(orderSalesPeriods),

  priceSuppliers: many(orderPriceSuppliers),

  uploads: many(orderUploads),

  stockEvents: many(orderStockEvents),

  items: many(orderItems),

}));



export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({

  order: one(orders, {

    fields: [orderItems.orderId],

    references: [orders.id],

  }),

  storeProduct: one(storeProducts, {

    fields: [orderItems.storeProductId],

    references: [storeProducts.id],

  }),

  supplierPrices: many(orderItemSupplierPrices),

}));

