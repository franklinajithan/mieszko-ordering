import { getLatestBookStockSummary } from "@/services/book-stock/apply-book-stock-to-order.service";
import { getNotPostedStoreSummary } from "@/services/not-posted/not-posted-import.service";
import {
  countUndatedFutureDeliveryLines,
  getFutureStoreSummary,
} from "@/services/future-deliveries/future-delivery-import.service";
import { calculateOrderSheet } from "@/services/order-sheet-calculation.service";
import {
  dailySalesRepository,
  orderRepository,
  storeRepository,
  supplierPriceRepository,
  supplierRepository,
} from "@/repositories";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { inArray } from "drizzle-orm";
import {
  boundingIsoRange,
  buildDailySalesByProductMap,
  dailySalesForProductInRange,
  formatComparisonPeriodDateRange,
  formatDaySalesLabel,
  listDatesInclusive,
  normalizeIsoDate,
  parseQty,
  periodSalesTotalsFromDailySales,
  totalUniquePeriodDays,
} from "@/utils/orderSheetCalculations";
import {
  type BookStockStatusRow,
  type OrderItemSupplierQuote,
  type OrderSheetGenerateInput,
  type OrderSheetItem,
  type OrderSheetMetadata,
  type OrderSheetResult,
  type OrderSheetSummary,
  type SalesDataStatusRow,
  type SoldQtyMethod,
  type SupplierDataStatusRow,
} from "@/types/orderSheet";
import type { orders } from "@/db/schema";
import { decimalToDb, parseDbDecimal } from "@/utils/decimal";
import { periodKeyForIndex, periodSalesList } from "@/utils/period-sales";

type OrderRow = typeof orders.$inferSelect;

function normalizeShortfallPeriods(
  value: unknown,
  fallbackStart: string,
  fallbackEnd: string,
): Array<{ startDate: string; endDate: string }> {
  if (Array.isArray(value) && value.length) {
    return value.filter(
      (period): period is { startDate: string; endDate: string } =>
        Boolean(
          period &&
            typeof period === "object" &&
            typeof period.startDate === "string" &&
            typeof period.endDate === "string",
        ),
    );
  }
  if (
    value &&
    typeof value === "object" &&
    "startDate" in value &&
    "endDate" in value &&
    typeof value.startDate === "string" &&
    typeof value.endDate === "string"
  ) {
    return [{ startDate: value.startDate, endDate: value.endDate }];
  }
  return [{ startDate: fallbackStart, endDate: fallbackEnd }];
}

export function primaryStoreId(order: { storeIds: number[] }): number {
  const storeId = order.storeIds[0];
  if (!storeId) throw new Error("Order has no store");
  return storeId;
}

export function settingsFromOrder(order: OrderRow): OrderSheetMetadata {
  return {
    storeIds: order.storeIds,
    supplierIds: order.supplierIds,
    orderDate: order.orderDate,
    soldQtyMethod: (order.soldQtyMethod as SoldQtyMethod) || "max",
    includeBookStock: true,
    includeFutureDeliveries: false,
    includeWastage: order.includeWastage,
    includeRtc: order.includeRtc,
    shortfallPeriods: normalizeShortfallPeriods(
      order.shortfallPeriods,
      order.orderDate,
      order.deliveryDate,
    ),
    comparisonPeriods: order.comparisonPeriods,
    dayBySalesRequired: order.includeDayByDaySales,
    dayBySalesStartDate: order.dayBySalesStartDate ?? undefined,
    dayBySalesEndDate: order.dayBySalesEndDate ?? undefined,
  };
}

function orderHeaderFromGenerate(
  input: OrderSheetGenerateInput,
  bookStockDate: string,
) {
  return {
    storeIds: input.storeIds,
    supplierIds: input.supplierIds,
    departmentIds: input.departmentIds,
    orderDate: input.orderDate,
    deliveryDate: input.deliveryDate,
    bookStockDate,
    includeBookStock: input.includeBookStock,
    includeFutureDeliveries: input.includeFutureDeliveries,
    includeWastage: input.includeWastage,
    includeRtc: input.includeRtc,
    includeDayByDaySales: input.dayBySalesRequired ?? false,
    dayBySalesStartDate: input.dayBySalesRequired
      ? (input.dayBySalesStartDate ?? null)
      : null,
    dayBySalesEndDate: input.dayBySalesRequired
      ? (input.dayBySalesEndDate ?? null)
      : null,
    soldQtyMethod: input.soldQtyMethod,
    comparisonPeriods: input.comparisonPeriods,
    shortfallPeriods: input.shortfallPeriods,
    comment: input.comment?.trim() || null,
    status: "draft" as const,
  };
}

function supplierStatusFromAge(importedAt: string | null): SupplierDataStatusRow["status"] {
  if (!importedAt) return "missing";
  const ageMs = Date.now() - new Date(importedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 2) return "current";
  if (ageDays <= 7) return "stale";
  return "missing";
}

export async function getSupplierDataStatus(
  supplierIds: number[],
): Promise<SupplierDataStatusRow[]> {
  if (!supplierIds.length) return [];
  const summaries = await supplierPriceRepository.listUploadSummaries();
  const latestBySupplier = new Map<number, (typeof summaries)[number]>();
  for (const row of summaries) {
    if (!supplierIds.includes(row.supplierId)) continue;
    if (!latestBySupplier.has(row.supplierId)) {
      latestBySupplier.set(row.supplierId, row);
    }
  }

  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(inArray(suppliers.id, supplierIds));
  const supplierById = new Map(supplierRows.map((row) => [row.id, row]));

  return supplierIds.map((supplierId) => {
    const latest = latestBySupplier.get(supplierId);
    const supplier = supplierById.get(supplierId);
    if (!latest) {
      return {
        supplierId,
        supplierCode: supplier?.code ?? "—",
        supplierName: supplier?.name ?? "Unknown",
        lastUpdated: null,
        status: "missing" as const,
      };
    }
    return {
      supplierId: latest.supplierId,
      supplierCode: latest.supplierCode,
      supplierName: latest.supplierName,
      lastUpdated: latest.importedAt,
      status: supplierStatusFromAge(latest.importedAt),
    };
  });
}

export async function resolveBookStockStatus(
  storeId: number,
  store?: { code: string; name: string },
): Promise<BookStockStatusRow> {
  const latest = await getLatestBookStockSummary(storeId);
  let notPosted = { fileCount: 0, itemCount: 0, totalQty: "0" };
  let future = { fileCount: 0, itemCount: 0, totalQty: "0" };
  try {
    notPosted = await getNotPostedStoreSummary(storeId);
  } catch {
    notPosted = { fileCount: 0, itemCount: 0, totalQty: "0" };
  }
  try {
    future = await getFutureStoreSummary(storeId);
  } catch {
    future = { fileCount: 0, itemCount: 0, totalQty: "0" };
  }
  if (!latest) {
    return {
      storeId,
      storeCode: store?.code ?? "—",
      storeName: store?.name ?? "Unknown",
      available: false,
      bookStockDate: null,
      importedAt: null,
      itemCount: 0,
      totalBookStockQty: null,
      notPostedFileCount: notPosted.fileCount,
      notPostedItemCount: notPosted.itemCount,
      notPostedQty: notPosted.totalQty,
      futureFileCount: future.fileCount,
      futureItemCount: future.itemCount,
      futureQty: future.totalQty,
      message: "No saved book stock",
    };
  }
  return {
    storeId,
    storeCode: store?.code ?? "—",
    storeName: store?.name ?? "Unknown",
    available: true,
    bookStockDate: latest.bookStockDate,
    importedAt: latest.importedAt,
    itemCount: latest.itemCount,
    totalBookStockQty: latest.totalBookStockQty,
    notPostedFileCount: notPosted.fileCount,
    notPostedItemCount: notPosted.itemCount,
    notPostedQty: notPosted.totalQty,
    futureFileCount: future.fileCount,
    futureItemCount: future.itemCount,
    futureQty: future.totalQty,
    message: "Latest upload",
  };
}

export async function resolveBookStockStatuses(
  storeIds: number[],
): Promise<BookStockStatusRow[]> {
  if (!storeIds.length) return [];
  const stores = await Promise.all(storeIds.map((id) => storeRepository.getById(id)));
  return Promise.all(
    storeIds.map((storeId, index) =>
      resolveBookStockStatus(storeId, stores[index] ?? undefined),
    ),
  );
}

/** Blockers that match generateOrderSheet / calculateOrderSheet validation. */
export async function resolveOrderSheetGenerationBlockers(input: {
  storeIds: number[];
  deliveryDate?: string;
  bookStockDate?: string;
  includeBookStock?: boolean;
  includeFutureDeliveries?: boolean;
}): Promise<string[]> {
  const { storeIds, deliveryDate, bookStockDate } = input;
  const blockers: string[] = [];
  const bookStock = input.includeBookStock !== false ? await resolveBookStockStatuses(storeIds) : [];
  for (const row of bookStock) {
    if (!row.available || !row.bookStockDate) {
      blockers.push(`Missing book stock: ${row.storeName}`);
    }
  }

  const snapshotDates = [
    ...new Set(
      bookStock
        .filter((row) => row.available && row.bookStockDate)
        .map((row) => row.bookStockDate),
    ),
  ] as string[];
  if (snapshotDates.length > 1) {
    blockers.push(
      "Selected stores have different book-stock snapshot dates (" +
        snapshotDates.join(", ") +
        "). Import matching snapshots or generate separate orders by snapshot date.",
    );
  }
  const primaryBookStockDate = snapshotDates[0];
  if (
    bookStockDate &&
    primaryBookStockDate &&
    bookStockDate !== primaryBookStockDate
  ) {
    blockers.push(
      "Book-stock date changed. Refresh stock status before generating.",
    );
  }
  if (deliveryDate && primaryBookStockDate && deliveryDate <= primaryBookStockDate) {
    blockers.push(
      "Delivery date must be after the book-stock snapshot date.",
    );
  }

  const stores = await Promise.all(storeIds.map((id) => storeRepository.getById(id)));
  const undated = input.includeFutureDeliveries ? await countUndatedFutureDeliveryLines(storeIds) : [];
  for (const entry of undated) {
    if (entry.undatedLineCount <= 0) continue;
    const store = stores.find((row) => row?.id === entry.storeId);
    blockers.push(
      `${entry.undatedLineCount} future-delivery lines lack expected arrival dates for ${store?.name ?? `store ${entry.storeId}`}. Set delivery dates on Book Stock before generating.`,
    );
  }

  return blockers;
}

export async function resolveSalesDataStatus(input: {
  storeIds: number[];
  startDate: string;
  endDate: string;
}): Promise<SalesDataStatusRow[]> {
  const { storeIds, startDate, endDate } = input;
  if (!storeIds.length || !startDate || !endDate || endDate < startDate) {
    return [];
  }

  const dates = listDatesInclusive(startDate, endDate);
  if (!dates.length) return [];

  const [stores, summaries] = await Promise.all([
    Promise.all(storeIds.map((id) => storeRepository.getById(id))),
    dailySalesRepository.listDateSummariesForStoresInRange(storeIds, startDate, endDate),
  ]);

  const storeById = new Map(
    stores.filter((store) => store !== null).map((store) => [store!.id, store!]),
  );

  const summaryByKey = new Map<string, (typeof summaries)[number]>();
  for (const row of summaries) {
    summaryByKey.set(
      `${row.storeId}|${normalizeIsoDate(row.salesDate)}`,
      row,
    );
  }

  const rows: SalesDataStatusRow[] = [];
  for (const salesDate of dates) {
    for (const storeId of storeIds) {
      const store = storeById.get(storeId);
      const summary = summaryByKey.get(`${storeId}|${salesDate}`);
      rows.push({
        salesDate,
        storeId,
        storeCode: store?.code ?? "—",
        storeName: store?.name ?? "Unknown",
        itemCount: summary?.itemCount ?? 0,
        totalSoldQty: summary?.totalSoldQty ?? "0",
        lastUpdated: summary?.lastUpdated ?? null,
        available: Boolean(summary?.itemCount),
      });
    }
  }

  return rows;
}

function extractPeriodSales(
  item: { periodSales: Array<{ periodKey: string; soldQty: string }> },
  periodCount: number,
): string[] {
  return periodSalesList(item.periodSales, periodCount);
}

function extractSupplierQuotes(item: {
  supplierQuotes?: OrderItemSupplierQuote[] | null;
  calculationBreakdown: unknown;
}): OrderItemSupplierQuote[] {
  if (Array.isArray(item.supplierQuotes) && item.supplierQuotes.length) {
    return item.supplierQuotes;
  }
  const breakdown =
    item.calculationBreakdown &&
    typeof item.calculationBreakdown === "object" &&
    item.calculationBreakdown !== null &&
    "orderSheet" in item.calculationBreakdown
      ? (item.calculationBreakdown as {
          orderSheet?: {
            supplierPrices?: Array<{
              supplierId: number;
              supplierKey?: string;
              supplierName?: string;
              supplierCode?: string | null;
              supplierProductCode?: string | null;
              netPrice?: string | null;
              caseSize?: string | null;
              isCheapest?: boolean;
              priceValidationStatus?: string;
              failureReason?: string | null;
            }>;
          };
        }).orderSheet
      : undefined;
  const snapshots = breakdown?.supplierPrices;
  if (!Array.isArray(snapshots)) return [];
  return snapshots.map((snapshot) => ({
    supplierId: snapshot.supplierId,
    supplierKey: snapshot.supplierKey ?? "",
    supplierName: snapshot.supplierName ?? "",
    supplierProductCode: snapshot.supplierProductCode ?? snapshot.supplierCode ?? null,
    netPrice: snapshot.netPrice ?? null,
    caseSize: snapshot.caseSize ?? null,
    isCheapest: Boolean(snapshot.isCheapest),
    priceValidationStatus: snapshot.priceValidationStatus ?? "valid",
    failureReason: snapshot.failureReason ?? null,
  }));
}

export async function buildOrderSheetResult(orderId: number): Promise<OrderSheetResult> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const metadata = settingsFromOrder(order);
  const storeIds = metadata.storeIds;

  const [periods, items, selectedSuppliers, bookStockStatus, storeRows] = await Promise.all([
    metadata?.comparisonPeriods?.length
      ? Promise.resolve(
          metadata.comparisonPeriods.map((period, index) => ({
            periodKey: periodKeyForIndex(index),
            startDate: period.startDate,
            endDate: period.endDate,
          })),
        )
      : orderRepository.getPeriods(orderId),
    orderRepository.getOrderItemsWithDetails(orderId),
    metadata?.supplierIds?.length
      ? supplierRepository
          .getByIds(metadata.supplierIds)
          .then((rows) => rows.map((supplier) => ({ supplier })))
      : orderRepository.getSelectedSuppliers(orderId),
    resolveBookStockStatuses(storeIds),
    Promise.all(storeIds.map((id) => storeRepository.getById(id))),
  ]);

  const storeById = new Map(
    storeRows.filter((store) => store !== null).map((store) => [store!.id, store!]),
  );

  const sortedPeriods = [...periods].sort((a, b) => {
    const ai = Number(a.periodKey.replace("period_", ""));
    const bi = Number(b.periodKey.replace("period_", ""));
    return ai - bi;
  });
  const periodCount = sortedPeriods.length;
  const comparisonPeriods = sortedPeriods.map((period, index) => ({
    periodKey: period.periodKey,
    title: `Period ${index + 1}`,
    dateRangeLabel: formatComparisonPeriodDateRange(period.startDate, period.endDate),
    startDate: period.startDate,
    endDate: period.endDate,
  }));
  const periodLabels = comparisonPeriods.map((column) => column.title);

  const comparisonSalesBounds = boundingIsoRange(
    sortedPeriods.map((period) => ({
      startDate: period.startDate,
      endDate: period.endDate,
    })),
  );
  const comparisonPeriodRanges = sortedPeriods.map((period) => ({
    startDate: period.startDate,
    endDate: period.endDate,
  }));

  const dailySalesDates =
    metadata?.dayBySalesRequired &&
    metadata.dayBySalesStartDate &&
    metadata.dayBySalesEndDate
      ? listDatesInclusive(metadata.dayBySalesStartDate, metadata.dayBySalesEndDate)
      : [];
  const dailySalesLabels = dailySalesDates.map(formatDaySalesLabel);

  const storeProductIds = items.map((row) => row.storeProduct.id);
  const salesQueryRanges = [
    ...(comparisonSalesBounds ? [comparisonSalesBounds] : []),
    ...(dailySalesDates.length &&
    metadata?.dayBySalesStartDate &&
    metadata?.dayBySalesEndDate
      ? [
          {
            startDate: metadata.dayBySalesStartDate,
            endDate: metadata.dayBySalesEndDate,
          },
        ]
      : []),
  ];
  const combinedSalesBounds = boundingIsoRange(salesQueryRanges);

  const salesByProductAndDate = combinedSalesBounds
    ? buildDailySalesByProductMap(
        await dailySalesRepository.getSalesByProductsInRange(
          storeProductIds,
          combinedSalesBounds.startDate,
          combinedSalesBounds.endDate,
        ),
      )
    : new Map<number, Map<string, string>>();

  const supplierById = new Map(
    selectedSuppliers.map((row) => [row.supplier.id, row.supplier]),
  );

  const mappedItems: OrderSheetItem[] = items.map((row) => {
    const breakdown =
      row.item.calculationBreakdown &&
      typeof row.item.calculationBreakdown === "object" &&
      row.item.calculationBreakdown !== null &&
      "orderSheet" in row.item.calculationBreakdown
        ? (row.item.calculationBreakdown as {
            orderSheet?: {
              wastageQty?: string;
              rtcQty?: string;
              calculatedSoldQty?: string;
              shortfallDays?: number;
              barcode?: string | null;
              dailySales?: Array<{ date: string; soldQty: string }>;
            };
          }).orderSheet
        : undefined;

    const quotes = extractSupplierQuotes(row.item);
    const cheapestQuote = quotes.find((quote) => quote.isCheapest) ?? null;
    const cheapestSupplier = row.item.cheapestSupplierId
      ? supplierById.get(row.item.cheapestSupplierId)
      : null;

    const store = storeById.get(row.storeProduct.storeId);

    return {
      orderItemId: row.item.id,
      storeProductId: row.storeProduct.id,
      storeCode: store?.code ?? null,
      storeName: store?.name ?? null,
      itemCode: row.storeProduct.storeProductCode,
      barcode: breakdown?.barcode ?? null,
      productName: row.product.name,
      supplierCode: cheapestQuote?.supplierProductCode ?? cheapestSupplier?.code ?? null,
      supplierName: cheapestSupplier?.name ?? cheapestQuote?.supplierName ?? null,
      supplierQuotes: quotes,
      departmentName: row.orderDepartmentName,
      currentStock: decimalToDb(
        parseDbDecimal(row.item.bookStockQty)
          .plus(parseDbDecimal(row.item.receivedNotPostedQty))
          .plus(parseDbDecimal(row.item.futureDeliveryTotalQty)),
      ),
      periodSales: comparisonSalesBounds
        ? periodSalesTotalsFromDailySales(
            salesByProductAndDate,
            row.storeProduct.id,
            comparisonPeriodRanges,
          )
        : extractPeriodSales(row.item, periodCount),
      dailySales: dailySalesDates.length
        ? dailySalesForProductInRange(
            salesByProductAndDate,
            row.storeProduct.id,
            dailySalesDates,
          )
        : [],
      calculatedSoldQty:
        breakdown?.calculatedSoldQty ?? row.item.highestSoldQty,
      wastageQty: breakdown?.wastageQty ?? "0",
      rtcQty: breakdown?.rtcQty ?? "0",
      shortfallDays: breakdown?.shortfallDays ?? 0,
      suggestedOrderQty: row.item.suggestedOrderQty,
      orderQty: row.item.finalOrderQty,
      selected: parseQty(row.item.finalOrderQty).gt(0),
    };
  });

  const productsToOrder = mappedItems.filter((item) =>
    parseQty(item.suggestedOrderQty).gt(0),
  ).length;
  const totalSuggestedQty = mappedItems
    .reduce((sum, item) => sum.plus(parseQty(item.suggestedOrderQty)), parseQty(0))
    .toFixed(2);

  const resultMetadata = settingsFromOrder(order);
  const shortfallDays = totalUniquePeriodDays(resultMetadata.shortfallPeriods);

  const summary: OrderSheetSummary = {
    productCount: mappedItems.length,
    productsToOrder,
    totalSuggestedQty,
    selectedSupplierCount: selectedSuppliers.length,
    shortfallDays,
  };

  return {
    orderId,
    summary,
    items: mappedItems,
    bookStockStatus,
    periodLabels,
    comparisonPeriods,
    dailySalesLabels,
    supplierColumns: selectedSuppliers.map(({ supplier }) => ({
      supplierId: supplier.id,
      code: supplier.code,
      name: supplier.name,
    })),
  };
}

export async function generateOrderSheet(
  input: OrderSheetGenerateInput,
): Promise<OrderSheetResult> {
  if (input.deliveryDate < input.orderDate) {
    throw new Error("Delivery date cannot be earlier than order date");
  }

  for (const period of input.comparisonPeriods) {
    if (period.endDate < period.startDate) {
      throw new Error("Comparison period end date cannot be before start date");
    }
  }

  if (!input.shortfallPeriods.length) {
    throw new Error("Add at least one shortfall period");
  }
  for (const period of input.shortfallPeriods) {
    if (period.endDate < period.startDate) {
      throw new Error("Shortfall end date cannot be before start date");
    }
  }

  if (input.dayBySalesRequired) {
    if (!input.dayBySalesStartDate || !input.dayBySalesEndDate) {
      throw new Error("Day-by-sales start and end dates are required");
    }
    if (input.dayBySalesEndDate < input.dayBySalesStartDate) {
      throw new Error("Day-by-sales end date cannot be before start date");
    }
    if (listDatesInclusive(input.dayBySalesStartDate, input.dayBySalesEndDate).length > 31) {
      throw new Error("Day-by-sales range cannot exceed 31 days");
    }
  }

  const storeIds = input.storeIds;
  const stores = await Promise.all(storeIds.map((id) => storeRepository.getById(id)));
  if (stores.some((store) => !store)) {
    throw new Error("One or more stores not found");
  }

  const bookStockStatuses = input.includeBookStock ? await resolveBookStockStatuses(storeIds) : [];
  const unavailable = bookStockStatuses.filter(
    (status) => !status.available || !status.bookStockDate,
  );
  if (unavailable.length) {
    const names = unavailable.map((status) => status.storeName).join(", ");
    throw new Error(
      `No stock snapshot is available for: ${names}. Import book stock before generating an order sheet.`,
    );
  }

  const snapshotDates = [...new Set(bookStockStatuses.map((status) => status.bookStockDate))];
  if (input.includeBookStock && snapshotDates.length !== 1) {
    throw new Error("Selected stores have different book-stock dates. Generate each store separately until per-store stock dates are supported.");
  }
  const primaryBookStock = bookStockStatuses[0]!;
  if (input.includeBookStock && input.bookStockDate && input.bookStockDate !== primaryBookStock?.bookStockDate) {
    throw new Error("Book-stock date changed. Refresh stock status before generating.");
  }

  const metadata: OrderSheetMetadata = {
    storeIds,
    supplierIds: input.supplierIds,
    orderDate: input.orderDate,
    soldQtyMethod: input.soldQtyMethod,
    includeWastage: input.includeWastage,
    includeRtc: input.includeRtc,
    shortfallPeriods: input.shortfallPeriods,
    comparisonPeriods: input.comparisonPeriods,
    dayBySalesRequired: input.dayBySalesRequired ?? false,
    dayBySalesStartDate: input.dayBySalesRequired ? input.dayBySalesStartDate : undefined,
    dayBySalesEndDate: input.dayBySalesRequired ? input.dayBySalesEndDate : undefined,
  };

  const header = orderHeaderFromGenerate(
    input,
    input.includeBookStock ? primaryBookStock!.bookStockDate! : input.orderDate,
  );

  let orderId = input.orderId;
  if (orderId) {
    await orderRepository.update(orderId, header);
  } else {
    const created = await orderRepository.create(header);
    orderId = created.id;
  }

  await calculateOrderSheet(orderId, metadata);
  // Preserve imported delivery records across generation and regeneration.

  return buildOrderSheetResult(orderId);
}

export async function saveOrderSheetDraft(input: {
  orderId: number;
  comment?: string;
  items: Array<{ orderItemId: number; orderQty: string; selected: boolean }>;
}): Promise<void> {
  const order = await orderRepository.getById(input.orderId);
  if (!order) throw new Error("Order not found");

  await orderRepository.update(input.orderId, {
    comment: input.comment?.trim() || null,
    status: "draft",
  });

  for (const item of input.items) {
    const qty = item.selected ? item.orderQty : "0";
    await orderRepository.updateFinalQuantity(item.orderItemId, qty);
  }
}

