import { z } from "zod";

export const createStoreSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  isActive: z.boolean().default(true),
});

export const updateStoreSchema = createStoreSchema.partial().extend({
  id: z.string().uuid(),
});

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  priceTiePriority: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  id: z.string().uuid(),
});

export const createProductSchema = z.object({
  name: z.string().min(1).max(500),
  department: z.string().min(1).max(100),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial().extend({
  id: z.string().uuid(),
});

export const storeProductSchema = z.object({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  storeProductCode: z.string().min(1).max(100),
  isActive: z.boolean().default(true),
});

export const barcodeSchema = z.object({
  productId: z.string().uuid(),
  barcode: z.string().min(1).max(100),
});

export const supplierProductSchema = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid(),
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
  storeId: z.string().uuid(),
  bookStockDate: z.string().date(),
  clientDeliveryDate: z.string().date(),
  departmentFilters: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const updateOrderPeriodsSchema = z.object({
  orderId: z.string().uuid(),
  periods: z.array(salesPeriodSchema).min(1),
});

export const updateOrderSuppliersSchema = z.object({
  orderId: z.string().uuid(),
  supplierIds: z.array(z.string().uuid()).min(1),
});

export const stockUploadSchema = z.object({
  orderId: z.string().uuid(),
  uploadType: z.enum([
    "book_stock",
    "received_not_posted",
    "future_delivery",
  ]),
  fileName: z.string().min(1),
  mappingType: z.enum(["store_product_code", "barcode", "supplier_code"]),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  supplierId: z.string().uuid().optional(),
  deliveryDate: z.string().date().optional(),
});

export const dailySalesImportSchema = z.object({
  storeId: z.string().uuid(),
  mappingType: z.enum(["store_product_code", "barcode"]),
  productColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  dateColumn: z.string().optional(),
  manualSalesDate: z.string().date().optional(),
  fileName: z.string().min(1),
});

export const supplierPriceImportSchema = z.object({
  supplierId: z.string().uuid(),
  referenceColumn: z.string().min(1),
  priceColumn: z.string().min(1),
  effectiveDate: z.string().date(),
  fileName: z.string().min(1),
});

export const updateFinalQuantitySchema = z.object({
  orderItemId: z.string().uuid(),
  finalOrderQty: z.string().regex(/^\d+(\.\d+)?$/),
});

export const calculateOrderSchema = z.object({
  orderId: z.string().uuid(),
});

export const exportOrderSchema = z.object({
  orderId: z.string().uuid(),
});
