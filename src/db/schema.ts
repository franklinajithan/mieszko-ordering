import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, varchar, } from "drizzle-orm/pg-core";
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
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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


export const departmentMappings = pgTable(
  "department_mappings",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    /** ERP/import department label from `products.department`. */
    importedDepartment: varchar("imported_department", { length: 100 }).notNull().unique(),
    orderDepartmentId: integer("order_department_id")
      .notNull()
      .references(() => departments.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);


export const products = pgTable("products", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  name: varchar("name", { length: 500 }).notNull(),

  /** Source/ERP department from import — never overwritten by order-department assignment. */
  department: varchar("department", { length: 100 }).notNull(),

  /** FK to `departments.id` for ordering; column name kept as `order_department_id`. */
  orderDepartment: integer("order_department_id").references(() => departments.id),

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

    retailPrice: numeric("retail_price", { precision: 18, scale: 4 }),

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



export const productBarcodes = pgTable(
  "product_barcodes",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => storeProducts.id),
    barcode: varchar("barcode", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Same EAN can exist on Mitcham and Gravesend; not twice in one store.
    unique("product_barcodes_store_barcode_unique").on(t.storeId, t.barcode),
    unique("product_barcodes_store_product_barcode_unique").on(
      t.storeProductId,
      t.barcode,
    ),
    index("product_barcodes_store_product_id_idx").on(t.storeProductId),
  ],
);



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

    unique("supplier_products_product_supplier_unique").on(

      t.productId,

      t.supplierId,

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



export const rtcSales = pgTable(
  "rtc_sales",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => storeProducts.id),
    rtcDate: date("rtc_date").notNull(),
    rtcQty: numeric("rtc_qty", { precision: 18, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("rtc_sales_store_product_date_unique").on(
      t.storeProductId,
      t.rtcDate,
    ),
  ],
);

export const promoSales = pgTable(
  "promo_sales",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => storeProducts.id),
    promoDate: date("promo_date").notNull(),
    promoQty: numeric("promo_qty", { precision: 18, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("promo_sales_store_product_date_unique").on(
      t.storeProductId,
      t.promoDate,
    ),
  ],
);

/** Per store-product wastage qty by date (same shape as rtc_sales, wastage-named). */
export const wastage = pgTable(
  "wastage",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => storeProducts.id),
    wastageDate: date("wastage_date").notNull(),
    wastageQty: numeric("wastage_qty", { precision: 18, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("wastage_store_product_date_unique").on(
      t.storeProductId,
      t.wastageDate,
    ),
  ],
);



/**
 * Supplier prices are product-wise (via supplier_products), not store-wise.
 * Each upload stamps the same importedAt on all rows; reads use the latest.
 */
export const supplierPrices = pgTable("supplier_prices", {

  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),

  supplierId: integer("supplier_id")

    .notNull()

    .references(() => suppliers.id),

  supplierProductId: integer("supplier_product_id").references(

    () => supplierProducts.id,

  ),

  supplierCode: varchar("supplier_code", { length: 100 }).notNull(),

  netPrice: numeric("net_price", { precision: 18, scale: 4 }).notNull(),

  /** MM Package text or SP/WAB Jednostek units — stored as text. */
  caseSize: varchar("case_size", { length: 100 }),

  effectiveDate: date("effective_date").notNull(),

  fileName: varchar("file_name", { length: 500 }),

  importedAt: timestamp("imported_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

  createdAt: timestamp("created_at", { withTimezone: true })

    .notNull()

    .defaultNow(),

});



/**
 * Book stock snapshots. Each upload gets one `imported_at` timestamp.
 * Multiple uploads for the same store/date are kept; ordering uses the latest.
 */
export const bookStock = pgTable(
  "book_stock",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => storeProducts.id),
    bookStockDate: date("book_stock_date").notNull(),
    bookStockQty: numeric("book_stock_qty", { precision: 18, scale: 4 }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("book_stock_store_product_imported_at_unique").on(
      t.storeProductId,
      t.importedAt,
    ),
    index("book_stock_date_imported_at_idx").on(t.bookStockDate, t.importedAt),
  ],
);

/**
 * Not-posted extras staged for the next generate.
 * Upload them at order-creation time; generate consumes the files and then
 * deletes them so the next order cannot reuse saved not-posted data.
 * A new book-stock upload also clears any leftover staging files.
 */
export const notPostedDeliveries = pgTable(
  "not_posted_deliveries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => storeProducts.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("not_posted_deliveries_store_product_idx").on(t.storeProductId),
    index("not_posted_deliveries_imported_at_idx").on(t.importedAt),
  ],
);

/**
 * Future extras uploaded for generate (OCS, order, or invoice).
 * Not tied to a book-stock timestamp: every saved file for the store is
 * summed onto current stock. Upload again on the next generate if still due in.
 * Order/invoice rows match supplier Index / INDEKS via supplier_id.
 */
export const futureDeliveries = pgTable(
  "future_deliveries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => storeProducts.id),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    source: varchar("source", { length: 20 }).notNull().default("ocs"),
    expectedDeliveryDate: date("expected_delivery_date"),
    supplierId: integer("supplier_id").references(() => suppliers.id),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("future_deliveries_store_product_idx").on(t.storeProductId),
    index("future_deliveries_imported_at_idx").on(t.importedAt),
    index("future_deliveries_source_idx").on(t.source),
    index("future_deliveries_supplier_idx").on(t.supplierId),
  ],
);



export const orders = pgTable("orders", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  storeIds: jsonb("store_ids").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  supplierIds: jsonb("supplier_ids").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  departmentIds: jsonb("department_ids").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  orderDate: date("order_date").notNull(),
  deliveryDate: date("delivery_date").notNull(),
  bookStockDate: date("book_stock_date").notNull(),
  includeWastage: boolean("include_wastage").notNull().default(false),
  includeRtc: boolean("include_rtc").notNull().default(false),
  includeDayByDaySales: boolean("include_day_by_day_sales").notNull().default(false),
  dayBySalesStartDate: date("day_by_sales_start_date"),
  dayBySalesEndDate: date("day_by_sales_end_date"),
  soldQtyMethod: varchar("sold_qty_method", { length: 20 }).notNull().default("max"),
  comparisonPeriods: jsonb("comparison_periods")
    .$type<Array<{ startDate: string; endDate: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  shortfallPeriods: jsonb("shortfall_period")
    .$type<Array<{ startDate: string; endDate: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  comment: text("comment"),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    periodSales: jsonb("period_sales")
      .$type<Array<{ periodKey: string; soldQty: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    supplierQuotes: jsonb("supplier_quotes")
      .$type<
        Array<{
          supplierId: number;
          supplierKey: string;
          supplierName: string;
          supplierProductCode: string | null;
          netPrice: string | null;
          caseSize: string | null;
          isCheapest: boolean;
          priceValidationStatus: string;
          failureReason: string | null;
        }>
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),
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

    caseSize: varchar("case_size", { length: 100 }),

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

}));



export const productsRelations = relations(products, ({ many }) => ({

  storeProducts: many(storeProducts),

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

  barcodes: many(productBarcodes),

  dailySales: many(dailySales),

  rtcSales: many(rtcSales),

  promoSales: many(promoSales),

  wastage: many(wastage),

}));

export const productBarcodesRelations = relations(productBarcodes, ({ one }) => ({
  store: one(stores, {
    fields: [productBarcodes.storeId],
    references: [stores.id],
  }),
  storeProduct: one(storeProducts, {
    fields: [productBarcodes.storeProductId],
    references: [storeProducts.id],
  }),
}));



export const departmentsRelations = relations(departments, ({ many }) => ({
  mappings: many(departmentMappings),
}));

export const departmentMappingsRelations = relations(
  departmentMappings,
  ({ one }) => ({
    orderDepartment: one(departments, {
      fields: [departmentMappings.orderDepartmentId],
      references: [departments.id],
    }),
  }),
);



export const ordersRelations = relations(orders, ({ many }) => ({
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


/** Office import audit records. Apply the staged SQL migration before use. */
export const dataImportRuns = pgTable("data_import_runs", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "set null" }),
  sourceType: varchar("source_type", { length: 32 }).notNull(),
  triggerType: varchar("trigger_type", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("queued"),
  sourceFileName: text("source_file_name"),
  sourceFilePath: text("source_file_path"),
  sourceStartDate: date("source_start_date"),
  sourceEndDate: date("source_end_date"),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  downloadedRowCount: integer("downloaded_row_count"),
  importedRowCount: integer("imported_row_count"),
  rejectedRowCount: integer("rejected_row_count"),
  errorMessage: text("error_message"),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
}, (table) => [
  index("data_import_runs_store_source_started_idx").on(table.storeId, table.sourceType, table.startedAt),
  index("data_import_runs_status_started_idx").on(table.status, table.startedAt),
]);
