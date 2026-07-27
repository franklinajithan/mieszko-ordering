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

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().max(50).optional(),
  isActive: z.boolean().default(true),
});

export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  id: idSchema,
});

export const departmentImportSchema = z.object({
  nameColumn: z.string().min(1),
  codeColumn: z.string().optional(),
  fileName: z.string().min(1),
});

export const departmentMappingSchema = z.object({
  importedDepartment: z.string().min(1).max(100),
  orderDepartmentId: idSchema,
});

export const createProductSchema = z.object({
  name: z.string().min(1).max(500),
  department: z.string().min(1).max(100),
  orderDepartment: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial().extend({
  id: idSchema,
});

export const assignOrderDepartmentSchema = z.object({
  productId: idSchema,
  orderDepartment: z.coerce.number().int().positive().nullable(),
});

export const storeProductSchema = z.object({
  storeId: idSchema,
  productId: idSchema,
  storeProductCode: z.string().min(1).max(100),
  retailPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
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

const salesPeriodInputSchema = z.object({
  periodKey: z.enum([
    "period_1",
    "period_2",
    "period_3",
    "previous_year",
  ]),
  startDate: z.string(),
  endDate: z.string(),
});

export const updateOrderPeriodsSchema = z
  .object({
    orderId: idSchema,
    periods: z.array(salesPeriodInputSchema),
  })
  .superRefine((data, ctx) => {
    const period1 = data.periods.find((p) => p.periodKey === "period_1");
    if (!period1?.startDate.trim() || !period1?.endDate.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Period 1 start and end dates are required",
        path: ["periods"],
      });
    }

    for (const period of data.periods) {
      const start = period.startDate.trim();
      const end = period.endDate.trim();
      const hasStart = Boolean(start);
      const hasEnd = Boolean(end);

      if (hasStart !== hasEnd) {
        ctx.addIssue({
          code: "custom",
          message: `${period.periodKey}: provide both start and end dates, or leave both empty`,
          path: ["periods"],
        });
        continue;
      }

      if (!hasStart) continue;

      if (!z.string().date().safeParse(start).success) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid start date for ${period.periodKey}`,
          path: ["periods"],
        });
      }
      if (!z.string().date().safeParse(end).success) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid end date for ${period.periodKey}`,
          path: ["periods"],
        });
      }
    }
  })
  .transform((data) => ({
    orderId: data.orderId,
    periods: data.periods
      .filter((p) => p.startDate.trim() && p.endDate.trim())
      .map((p) => ({
        periodKey: p.periodKey,
        startDate: p.startDate.trim(),
        endDate: p.endDate.trim(),
      })),
  }));

export const createOrderSchema = z.object({
  storeId: idSchema,
  bookStockDate: z.string().date(),
  clientDeliveryDate: z.string().date(),
  departmentFilters: z.array(z.coerce.number().int().positive()).default([]),
  notes: z.string().optional(),
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

export const rtcImportSchema = z.object({
  storeId: idSchema,
  rtcDate: z.string().date(),
  mappingType: z.enum(["store_product_code", "barcode"]).default("store_product_code"),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1),
});

export const promoImportSchema = z.object({
  storeId: idSchema,
  promoDate: z.string().date(),
  mappingType: z.enum(["store_product_code", "barcode"]).default("store_product_code"),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1),
});

export const wastageImportSchema = z.object({
  storeId: idSchema,
  wastageDate: z.string().date(),
  mappingType: z.enum(["store_product_code", "barcode"]).default("store_product_code"),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1),
});

export const applyStoredBookStockSchema = z.object({
  orderId: idSchema,
  importId: idSchema,
});
