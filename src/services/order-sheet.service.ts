import {
  getLatestBookStockSummary,
  applyBookStockForStores,
} from "@/services/book-stock/apply-book-stock-to-order.service";
import { calculateOrderSheet } from "@/services/order-sheet-calculation.service";
import {
  dailySalesRepository,
  orderRepository,
  storeRepository,
  supplierPriceRepository,
} from "@/repositories";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { inArray } from "drizzle-orm";
import {
  buildDailySalesByProductMap,
  dailySalesForProductInRange,
  diffDaysInclusive,
  formatDaySalesLabel,
  listDatesInclusive,
  normalizeIsoDate,
  parseQty,
} from "@/utils/orderSheetCalculations";
import type {
  BookStockStatusRow,
  OrderSheetGenerateInput,
  OrderSheetItem,
  OrderSheetMetadata,
  OrderSheetResult,
  OrderSheetSummary,
  SalesDataStatusRow,
  SupplierDataStatusRow,
} from "@/types/orderSheet";

function encodeOrderSheetNotes(metadata: OrderSheetMetadata, comment?: string): string {
  return JSON.stringify({
    orderSheet: metadata,
    comment: comment?.trim() || "",
  });
}

function decodeOrderSheetNotes(notes: string | null): {
  metadata: OrderSheetMetadata | null;
  comment: string;
} {
  if (!notes?.trim()) return { metadata: null, comment: "" };
  try {
    const parsed = JSON.parse(notes) as {
      orderSheet?: OrderSheetMetadata;
      comment?: string;
    };
    return {
      metadata: parsed.orderSheet ?? null,
      comment: parsed.comment ?? "",
    };
  } catch {
    return { metadata: null, comment: notes };
  }
}

function periodKeyForIndex(index: number): string {
  return `period_${index + 1}`;
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

function extractPeriodSales(item: {
  period1Sales: string;
  period2Sales: string;
  period3Sales: string;
  previousYearSales: string;
  calculationBreakdown: unknown;
}, periodCount: number): string[] {
  const breakdown =
    item.calculationBreakdown &&
    typeof item.calculationBreakdown === "object" &&
    item.calculationBreakdown !== null &&
    "orderSheet" in item.calculationBreakdown
      ? (item.calculationBreakdown as {
          orderSheet?: { extraPeriodSales?: Array<{ periodKey: string; soldQty: string }> };
        }).orderSheet
      : undefined;

  const extra = new Map(
    (breakdown?.extraPeriodSales ?? []).map((row) => [row.periodKey, row.soldQty]),
  );

  const base = [
    item.period1Sales,
    item.period2Sales,
    item.period3Sales,
  ];

  const sales: string[] = [];
  for (let index = 0; index < periodCount; index += 1) {
    const key = periodKeyForIndex(index);
    if (index < 3) {
      sales.push(base[index] ?? "0");
    } else {
      sales.push(extra.get(key) ?? "0");
    }
  }
  return sales;
}

export async function buildOrderSheetResult(orderId: number): Promise<OrderSheetResult> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const { metadata } = decodeOrderSheetNotes(order.notes);
  const storeIds = metadata?.storeIds?.length ? metadata.storeIds : [order.storeId];

  const [periods, items, selectedSuppliers, bookStockStatus, storeRows] = await Promise.all([
    orderRepository.getPeriods(orderId),
    orderRepository.getOrderItemsWithDetails(orderId),
    orderRepository.getSelectedSuppliers(orderId),
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
  const periodLabels = sortedPeriods.map((_, index) => `P${index + 1}`);

  const dailySalesDates =
    metadata?.dayBySalesRequired &&
    metadata.dayBySalesStartDate &&
    metadata.dayBySalesEndDate
      ? listDatesInclusive(metadata.dayBySalesStartDate, metadata.dayBySalesEndDate)
      : [];
  const dailySalesLabels = dailySalesDates.map(formatDaySalesLabel);

  const salesByProductAndDate =
    dailySalesDates.length &&
    metadata?.dayBySalesStartDate &&
    metadata?.dayBySalesEndDate
      ? buildDailySalesByProductMap(
          await dailySalesRepository.getSalesByProductsInRange(
            items.map((row) => row.storeProduct.id),
            metadata.dayBySalesStartDate,
            metadata.dayBySalesEndDate,
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
      supplierCode: cheapestSupplier?.code ?? null,
      supplierName: cheapestSupplier?.name ?? null,
      departmentName: row.orderDepartmentName,
      currentStock: row.item.bookStockQty,
      periodSales: extractPeriodSales(row.item, periodCount),
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

  const { metadata: resultMetadata } = decodeOrderSheetNotes(order.notes);
  const shortfallDays = resultMetadata
    ? diffDaysInclusive(resultMetadata.shortfallStartDate, resultMetadata.shortfallEndDate)
    : diffDaysInclusive(order.bookStockDate, order.clientDeliveryDate);

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
    dailySalesLabels,
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

  if (input.shortfallEndDate < input.shortfallStartDate) {
    throw new Error("Shortfall end date cannot be before start date");
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

  const bookStockStatuses = await resolveBookStockStatuses(storeIds);
  const unavailable = bookStockStatuses.filter(
    (status) => !status.available || !status.bookStockDate,
  );
  if (unavailable.length) {
    const names = unavailable.map((status) => status.storeName).join(", ");
    throw new Error(
      `No stock snapshot is available for: ${names}. Import book stock before generating an order sheet.`,
    );
  }

  const primaryStoreId = storeIds[0]!;
  const primaryStore = stores[0]!;
  const primaryBookStock = bookStockStatuses[0]!;

  const metadata: OrderSheetMetadata = {
    storeIds,
    orderDate: input.orderDate,
    soldQtyMethod: input.soldQtyMethod,
    includeWastage: input.includeWastage,
    includeRtc: input.includeRtc,
    shortfallStartDate: input.shortfallStartDate,
    shortfallEndDate: input.shortfallEndDate,
    comparisonPeriods: input.comparisonPeriods,
    dayBySalesRequired: input.dayBySalesRequired ?? false,
    dayBySalesStartDate: input.dayBySalesRequired ? input.dayBySalesStartDate : undefined,
    dayBySalesEndDate: input.dayBySalesRequired ? input.dayBySalesEndDate : undefined,
  };

  let orderId = input.orderId;
  if (orderId) {
    await orderRepository.update(orderId, {
      storeId: primaryStoreId,
      bookStockDate: input.bookStockDate || primaryBookStock.bookStockDate!,
      clientDeliveryDate: input.deliveryDate,
      departmentFilters: input.departmentIds.map(String),
      notes: encodeOrderSheetNotes(metadata, input.comment),
      status: "draft",
    });
  } else {
    const created = await orderRepository.create({
      storeId: primaryStoreId,
      bookStockDate: input.bookStockDate || primaryBookStock.bookStockDate!,
      clientDeliveryDate: input.deliveryDate,
      departmentFilters: input.departmentIds.map(String),
      notes: encodeOrderSheetNotes(metadata, input.comment),
      status: "draft",
    });
    orderId = created.id;
  }

  await orderRepository.replacePeriods(
    orderId,
    input.comparisonPeriods.map((period, index) => ({
      orderId,
      periodKey: periodKeyForIndex(index),
      startDate: period.startDate,
      endDate: period.endDate,
    })),
  );

  await orderRepository.replacePriceSuppliers(orderId, input.supplierIds);

  try {
    await applyBookStockForStores({
      orderId,
      storeIds,
      bookStockDate: input.bookStockDate || primaryBookStock.bookStockDate!,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to apply book stock";
    throw new Error(
      `Could not apply book stock for ${primaryStore.name}. ${message}`,
    );
  }

  await calculateOrderSheet(orderId, metadata);

  return buildOrderSheetResult(orderId);
}

export async function saveOrderSheetDraft(input: {
  orderId: number;
  comment?: string;
  items: Array<{ orderItemId: number; orderQty: string; selected: boolean }>;
}): Promise<void> {
  const order = await orderRepository.getById(input.orderId);
  if (!order) throw new Error("Order not found");

  const { metadata } = decodeOrderSheetNotes(order.notes);
  if (metadata) {
    await orderRepository.update(input.orderId, {
      notes: encodeOrderSheetNotes(metadata, input.comment),
      status: "draft",
    });
  } else if (input.comment !== undefined) {
    await orderRepository.update(input.orderId, {
      notes: input.comment,
      status: "draft",
    });
  }

  for (const item of input.items) {
    const qty = item.selected ? item.orderQty : "0";
    await orderRepository.updateFinalQuantity(item.orderItemId, qty);
  }
}

export { decodeOrderSheetNotes };
