import { z } from "zod";

export const idSchema = z.coerce.number().int().positive();

export const createStoreSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  erpType: z.enum(["msp", "glopos"]).default("msp"),
  isActive: z.boolean().default(true),
});

export const updateStoreSchema = createStoreSchema.partial().extend({
  id: idSchema,
});

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  priceTiePriority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  id: idSchema,
});

export const createProductSchema = z.object({
  name: z.string().min(1).max(500),
  department: z.string().min(1).max(100),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial().extend({
  id: idSchema,
});

export const storeProductSchema = z.object({
  storeId: idSchema,
  productId: idSchema,
  storeProductCode: z.string().min(1).max(100),
  isActive: z.boolean().default(true),
});

export const barcodeSchema = z.object({
  productId: idSchema,
  barcode: z.string().min(1).max(100),
});

export const supplierProductSchema = z.object({
  productId: idSchema,
  supplierId: idSchema,
  supplierCode: z.string().min(1).max(100),
  isActive: z.boolean().default(true),
});

export const salesPeriodSchema = z.object({
  periodKey: z.enum([
    "period_1",
    "period_2",
    "period_3",
    "previous_year",
  ]),
  startDate: z.string().date(),
  endDate: z.string().date(),
});

export const createOrderSchema = z.object({
  storeId: idSchema,
  bookStockDate: z.string().date(),
  clientDeliveryDate: z.string().date(),
  departmentFilters: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const updateOrderPeriodsSchema = z.object({
  orderId: idSchema,
  periods: z.array(salesPeriodSchema).min(1),
});

export const updateOrderSuppliersSchema = z.object({
  orderId: idSchema,
  supplierIds: z.array(idSchema).min(1),
});

export const stockUploadSchema = z.object({
  orderId: idSchema,
  uploadType: z.enum([
    "book_stock",
    "received_not_posted",
    "future_delivery",
  ]),
  fileName: z.string().min(1),
  mappingType: z.enum(["store_product_code", "barcode", "supplier_code"]),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  supplierId: idSchema.optional(),
  deliveryDate: z.string().date().optional(),
});

export const dailySalesImportSchema = z.object({
  storeId: idSchema,
  mappingType: z.enum(["store_product_code", "barcode"]),
  productColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  dateColumn: z.string().optional(),
  manualSalesDate: z.string().date().optional(),
  fileName: z.string().min(1),
});

export const supplierPriceImportSchema = z.object({
  supplierId: idSchema,
  referenceColumn: z.string().min(1),
  priceColumn: z.string().min(1),
  effectiveDate: z.string().date(),
  fileName: z.string().min(1),
});

export const updateFinalQuantitySchema = z.object({
  orderItemId: idSchema,
  finalOrderQty: z.string().regex(/^\d+(\.\d+)?$/),
});

export const calculateOrderSchema = z.object({
  orderId: idSchema,
});

export const exportOrderSchema = z.object({
  orderId: idSchema,
});

export const bookStockImportSchema = z.object({
  storeId: idSchema,
  bookStockDate: z.string().date(),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1),
});

export const applyStoredBookStockSchema = z.object({
  orderId: idSchema,
  importId: idSchema,
});
