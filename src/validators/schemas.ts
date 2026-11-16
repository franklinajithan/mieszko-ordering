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
  storeId: idSchema,
  barcode: z.string().min(1).max(100),
});

export const supplierProductSchema = z.object({
  productId: idSchema,
  supplierId: idSchema,
  supplierCode: z.string().max(100).optional().default(""),
  isActive: z.boolean().default(true),
  /** When true, mark confirmed unavailable (same as “Not in MM/SP/WAB”). */
  unavailable: z.boolean().optional().default(false),
});

const periodKeySchema = z
  .string()
  .regex(/^(period_[1-9]\d*|previous_year)$/);

export const salesPeriodSchema = z.object({
  periodKey: periodKeySchema,
  startDate: z.string().date(),
  endDate: z.string().date(),
});

const salesPeriodInputSchema = z.object({
  periodKey: periodKeySchema,
  startDate: z.string(),
  endDate: z.string(),
});

const dateRangeSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
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
  orderDate: z.string().date(),
  deliveryDate: z.string().date(),
  bookStockDate: z.string().date(),
  storeIds: z.array(idSchema).min(1),
  supplierIds: z.array(idSchema).default([]),
  departmentIds: z.array(idSchema).default([]),
  includeWastage: z.boolean().default(false),
  includeRtc: z.boolean().default(false),
  includeDayByDaySales: z.boolean().default(false),
  dayBySalesStartDate: z.string().date().optional(),
  dayBySalesEndDate: z.string().date().optional(),
  soldQtyMethod: z.enum(["max", "average", "min"]).default("max"),
  comparisonPeriods: z.array(dateRangeSchema).default([]),
  shortfallPeriods: z.array(dateRangeSchema).default([]),
  comment: z.string().optional(),
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

export const supplierPriceImportSchema = z.object({
  supplierId: idSchema,
  referenceColumn: z.string().min(1),
  priceColumn: z.string().min(1),
  caseSizeColumn: z.string().min(1).optional(),
  effectiveDate: z.string().date(),
  validUntil: z.string().date().optional(),
  /** ISO timestamp — distinguishes multiple uploads on the same day. */
  importedAt: z.string().datetime().optional(),
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
});

export const promoImportSchema = z.object({
  storeId: idSchema,
  promoDate: z.string().date(),
  referenceColumn: z.string().min(1),
  quantityColumn: z.string().min(1),
  fileName: z.string().min(1).optional(),
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
  importedAt: z.string().datetime().optional(),
  bookStockDate: z.string().date().optional(),
});

export const orderSheetGenerateSchema = z
  .object({
    orderId: idSchema.optional(),
    storeIds: z.array(idSchema).min(1),
    orderDate: z.string().date(),
    deliveryDate: z.string().date(),
    bookStockDate: z.string().date().optional(),
    supplierIds: z.array(idSchema).min(1),
    departmentIds: z.array(idSchema).default([]),
    comparisonPeriods: z.array(dateRangeSchema).min(1),
    includeBookStock: z.boolean().default(true),
    includeFutureDeliveries: z.boolean().default(false),
    includeWastage: z.boolean().default(true),
    includeRtc: z.boolean().default(true),
    shortfallPeriods: z.array(dateRangeSchema).min(1),
    soldQtyMethod: z.enum(["max", "average", "min"]).default("average"),
    comment: z.string().max(500).optional(),
    dayBySalesRequired: z.boolean().default(false),
    dayBySalesStartDate: z.string().date().optional(),
    dayBySalesEndDate: z.string().date().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.deliveryDate < data.orderDate) {
      ctx.addIssue({
        code: "custom",
        message: "Delivery date cannot be earlier than order date",
        path: ["deliveryDate"],
      });
    }
    for (const [index, period] of data.shortfallPeriods.entries()) {
      if (period.endDate < period.startDate) {
        ctx.addIssue({
          code: "custom",
          message: `Shortfall period ${index + 1} has an invalid date range`,
          path: ["shortfallPeriods", index],
        });
      }
    }
    for (const [index, period] of data.comparisonPeriods.entries()) {
      if (period.endDate < period.startDate) {
        ctx.addIssue({
          code: "custom",
          message: `Period ${index + 1} has an invalid date range`,
          path: ["comparisonPeriods", index],
        });
      }
    }
    if (data.dayBySalesRequired) {
      if (!data.dayBySalesStartDate) {
        ctx.addIssue({
          code: "custom",
          message: "Day-by-sales start date is required",
          path: ["dayBySalesStartDate"],
        });
      }
      if (!data.dayBySalesEndDate) {
        ctx.addIssue({
          code: "custom",
          message: "Day-by-sales end date is required",
          path: ["dayBySalesEndDate"],
        });
      }
      if (
        data.dayBySalesStartDate &&
        data.dayBySalesEndDate &&
        data.dayBySalesEndDate < data.dayBySalesStartDate
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Day-by-sales end date cannot be before start date",
          path: ["dayBySalesEndDate"],
        });
      }
      if (data.dayBySalesStartDate && data.dayBySalesEndDate) {
        const start = new Date(`${data.dayBySalesStartDate}T00:00:00`);
        const end = new Date(`${data.dayBySalesEndDate}T00:00:00`);
        const days =
          Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        if (days > 31) {
          ctx.addIssue({
            code: "custom",
            message: "Day-by-sales range cannot exceed 31 days",
            path: ["dayBySalesEndDate"],
          });
        }
      }
    }
  });

export const orderSheetDraftSchema = z.object({
  comment: z.string().max(500).optional(),
  items: z.array(
    z.object({
      orderItemId: idSchema,
      orderQty: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/),
      selected: z.boolean(),
    }),
  ),
});
