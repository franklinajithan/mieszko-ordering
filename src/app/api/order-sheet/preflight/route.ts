import { getImportCoverage } from "@/services/import-readiness.service";
import { z } from "zod";
import { apiOk, parseJson, route } from "@/lib/api/http";
import {
  getSupplierDataStatus,
  resolveBookStockStatuses,
  resolveOrderSheetGenerationBlockers,
  resolveSalesDataStatus,
} from "@/services/order-sheet.service";

const inputSchema = z.object({
  storeIds: z.array(z.number().int().positive()).min(1),
  supplierIds: z.array(z.number().int().positive()).min(1),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeRtc: z.boolean().default(true),
  includeWastage: z.boolean().default(true),
  includeBookStock: z.boolean().default(true),
  includeFutureDeliveries: z.boolean().default(false),
  bookStockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dayBySalesRequired: z.boolean().default(false),
  dayBySalesStartDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
  dayBySalesEndDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
  comparisonPeriods: z.array(z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1),
});

/** Read-only preflight: no orders, stock or delivery records are modified. */
export const POST = route(async (req) => {
  const parsed = await parseJson(req, inputSchema);
  if (!parsed.ok) return parsed.response;
  const { storeIds, supplierIds, comparisonPeriods, deliveryDate, bookStockDate, includeBookStock, includeFutureDeliveries } =
    parsed.data;
  const [bookStock, suppliers, salesPeriods, generationBlockers, feeds] = await Promise.all([
    includeBookStock ? resolveBookStockStatuses(storeIds) : Promise.resolve([]),
    getSupplierDataStatus(supplierIds),
    Promise.all(comparisonPeriods.map(async (period) => ({
      period,
      rows: await resolveSalesDataStatus({ storeIds, ...period }),
    }))),
    resolveOrderSheetGenerationBlockers({ storeIds, deliveryDate, bookStockDate, includeBookStock, includeFutureDeliveries }),
    getImportCoverage({...parsed.data}),
  ]);
  const blockers = generationBlockers;
  const warnings = [
    ...feeds.warnings,
    ...suppliers.filter((row) => row.status !== "current").map(
      (row) => `Supplier price data ${row.status}: ${row.supplierName}`,
    ),
    ...salesPeriods.flatMap(({ period, rows }) => {
      const missing = rows.filter((row) => !row.available);
      return missing.length
        ? [`Missing daily sales for ${missing.length} store/date combinations in ${period.startDate}–${period.endDate}`]
        : [];
    }),
  ];
  return apiOk({
    ready: blockers.length === 0,
    blockers,
    warnings,
    bookStock,
    feedCoverage:feeds.coverage,
    suppliers,
    salesPeriods: salesPeriods.map(({ period, rows }) => ({
      ...period,
      totalStoreDays: rows.length,
      availableStoreDays: rows.filter((row) => row.available).length,
      totalItems: rows.reduce((sum, row) => sum + row.itemCount, 0),
    })),
  });
});
