import { z } from "zod";
import { apiOk, parseJson, route } from "@/lib/api/http";
import {
  getSupplierDataStatus,
  resolveBookStockStatuses,
  resolveSalesDataStatus,
} from "@/services/order-sheet.service";

const inputSchema = z.object({
  storeIds: z.array(z.number().int().positive()).min(1),
  supplierIds: z.array(z.number().int().positive()).min(1),
  comparisonPeriods: z.array(z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1),
});

/** Read-only preflight: no orders, stock or delivery records are modified. */
export const POST = route(async (req) => {
  const parsed = await parseJson(req, inputSchema);
  if (!parsed.ok) return parsed.response;
  const { storeIds, supplierIds, comparisonPeriods } = parsed.data;
  const [bookStock, suppliers, salesPeriods] = await Promise.all([
    resolveBookStockStatuses(storeIds),
    getSupplierDataStatus(supplierIds),
    Promise.all(comparisonPeriods.map(async (period) => ({
      period,
      rows: await resolveSalesDataStatus({ storeIds, ...period }),
    }))),
  ]);
  const blockers = bookStock
    .filter((row) => !row.available || !row.bookStockDate)
    .map((row) => `Missing book stock: ${row.storeName}`);
  const snapshotDates = [...new Set(bookStock
    .filter((row) => row.available && row.bookStockDate)
    .map((row) => row.bookStockDate))];
  if (snapshotDates.length > 1) {
    blockers.push(
      "Selected stores have different book-stock snapshot dates (" +
      snapshotDates.join(", ") +
      "). Import matching snapshots or generate separate orders by snapshot date.",
    );
  }
  const warnings = [
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
    suppliers,
    salesPeriods: salesPeriods.map(({ period, rows }) => ({
      ...period,
      totalStoreDays: rows.length,
      availableStoreDays: rows.filter((row) => row.available).length,
      totalItems: rows.reduce((sum, row) => sum + row.itemCount, 0),
    })),
  });
});
