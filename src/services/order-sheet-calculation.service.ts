import { db } from "@/db";
import { orderItems, productBarcodes } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE } from "@/lib/import-config";
import {
  bookStockRepository,
  dailySalesRepository,
  futureDeliveryRepository,
  notPostedDeliveryRepository,
  orderRepository,
  rtcSalesRepository,
  supplierPriceRepository,
  supplierRepository,
  wastageRepository,
} from "@/repositories";
import { compareSupplierPrices, toOrderItemSupplierQuotes } from "@/services/supplier-prices/supplier-price.service";
import {
  aggregatePeriodSales,
  averageComparisonPeriodDays,
  boundingIsoRange,
  buildDailySalesByProductMap,
  calculateOrderSheetSuggestedQty,
  dailySalesForProductInRange,
  listDatesInclusive,
  roundOrderQty,
  scaleSoldQtyForShortfall,
  sumQtyInDateRange,
  totalUniquePeriodDays,
} from "@/utils/orderSheetCalculations";
import { Decimal, decimalToDb, parseDbDecimal, type Decimal as DecimalType } from "@/utils/decimal";
import { toPeriodSalesRows } from "@/utils/period-sales";
import type { OrderSheetMetadata } from "@/types/orderSheet";
import {
  simulateStockTimeline,
  type StockEvent,
} from "@/services/orders/stock-simulation.service";
import {
  buildHistoricalSalesMap,
  WeekdayHistoricalForecastService,
} from "@/services/orders/sales-forecast.service";

export type OrderSheetCalculationOptions = OrderSheetMetadata;

function periodSortKey(periodKey: string): number {
  const match = periodKey.match(/^period_(\d+)$/);
  return match ? Number(match[1]) : 999;
}

async function loadBarcodesByStoreProduct(
  storeId: number,
  storeProductIds: number[],
): Promise<Map<number, string>> {
  const uniqueIds = [...new Set(storeProductIds)];
  if (!uniqueIds.length) return new Map();
  const map = new Map<number, string>();
  for (
    let index = 0;
    index < uniqueIds.length;
    index += BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE
  ) {
    const batch = uniqueIds.slice(index, index + BOOK_STOCK_CODE_LOOKUP_BATCH_SIZE);
    if (!batch.length) continue;
    const rows = await db
      .select({
        storeProductId: productBarcodes.storeProductId,
        barcode: productBarcodes.barcode,
      })
      .from(productBarcodes)
      .where(
        and(
          eq(productBarcodes.storeId, storeId),
          inArray(productBarcodes.storeProductId, batch),
        ),
      );
    for (const row of rows) {
      if (!map.has(row.storeProductId)) {
        map.set(row.storeProductId, row.barcode);
      }
    }
  }
  return map;
}

function qtyMapFromRows(
  rows: Array<{ storeProductId: number; date: string | Date; qty: string }>,
) {
  return buildDailySalesByProductMap(
    rows.map((row) => ({
      storeProductId: row.storeProductId,
      salesDate: row.date,
      soldQty: row.qty,
    })),
  );
}

function historicalMapFromDaily(byDate: Map<string, string> | undefined) {
  if (!byDate?.size) return new Map<string, DecimalType>();
  return buildHistoricalSalesMap(
    [...byDate.entries()].map(([salesDate, soldQty]) => ({ salesDate, soldQty })),
  );
}

function averagePeriodQty(
  byDate: Map<string, string> | undefined,
  periods: Array<{ startDate: string; endDate: string }>,
) {
  let total = new Decimal(0);
  for (const period of periods) {
    total = total.plus(sumQtyInDateRange(byDate, period.startDate, period.endDate));
  }
  if (periods.length > 1) {
    return total.div(periods.length);
  }
  return total;
}

export async function calculateOrderSheet(
  orderId: number,
  options: OrderSheetCalculationOptions,
): Promise<void> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const periods = (
    options.comparisonPeriods.length
      ? options.comparisonPeriods.map((period, index) => ({
          periodKey: `period_${index + 1}`,
          startDate: period.startDate,
          endDate: period.endDate,
        }))
      : await orderRepository.getPeriods(orderId)
  ).sort((a, b) => periodSortKey(a.periodKey) - periodSortKey(b.periodKey));
  if (!periods.length) {
    throw new Error("Add at least one comparison period");
  }

  const supplierRows = options.supplierIds?.length
    ? await supplierRepository.getByIds(options.supplierIds)
    : (await orderRepository.getSelectedSuppliers(orderId)).map((row) => row.supplier);
  const selectedSuppliers = supplierRows.map((supplier) => ({ supplier }));
  if (!selectedSuppliers.length) {
    throw new Error("Select at least one supplier");
  }

  const departmentIds = (order.departmentIds ?? []).filter(
    (id) => Number.isInteger(id) && id > 0,
  );

  const storeIds = options.storeIds?.length ? options.storeIds : order.storeIds;
  const storeProducts: Awaited<
    ReturnType<typeof orderRepository.getStoreProductsForOrder>
  > = [];

  for (const storeId of storeIds) {
    const rows = await orderRepository.getStoreProductsForOrder(storeId, departmentIds);
    storeProducts.push(...rows);
  }

  if (!storeProducts.length) {
    throw new Error("No products found for the selected stores, suppliers, and departments");
  }

  const storeProductIds = storeProducts.map((row) => row.storeProduct.id);
  const productIds = [...new Set(storeProducts.map((row) => row.product.id))];
  const selectedSupplierIds = selectedSuppliers.map(({ supplier }) => supplier.id);
  const comparisonRanges = periods.map((period) => ({
    startDate: period.startDate,
    endDate: period.endDate,
  }));
  const comparisonBounds = boundingIsoRange(comparisonRanges);
  const dayBySalesDates =
    options.dayBySalesRequired &&
    options.dayBySalesStartDate &&
    options.dayBySalesEndDate
      ? listDatesInclusive(options.dayBySalesStartDate, options.dayBySalesEndDate)
      : [];
  const salesBounds = boundingIsoRange([
    ...comparisonRanges,
    ...(options.dayBySalesRequired &&
    options.dayBySalesStartDate &&
    options.dayBySalesEndDate
      ? [
          {
            startDate: options.dayBySalesStartDate,
            endDate: options.dayBySalesEndDate,
          },
        ]
      : []),
  ]);

  const productsByStore = new Map<number, typeof storeProducts>();
  for (const row of storeProducts) {
    const storeId = row.storeProduct.storeId;
    const list = productsByStore.get(storeId) ?? [];
    list.push(row);
    productsByStore.set(storeId, list);
  }

  const [
    bookStockByProduct,
    notPostedByProduct,
    futureByProduct,
    salesRows,
    wastageRows,
    rtcRows,
    mappings,
    storeBarcodeMaps,
  ] = await Promise.all([
    bookStockRepository.latestQtyByStoreProductIds(storeProductIds),
    notPostedDeliveryRepository.sumQtyByStoreProductIds(storeProductIds),
    futureDeliveryRepository.sumQtyByStoreProductIds(storeProductIds),
    salesBounds
      ? dailySalesRepository.getSalesByProductsInRange(
          storeProductIds,
          salesBounds.startDate,
          salesBounds.endDate,
        )
      : Promise.resolve([]),
    options.includeWastage && comparisonBounds
      ? wastageRepository.getByProductsInRange(
          storeProductIds,
          comparisonBounds.startDate,
          comparisonBounds.endDate,
        )
      : Promise.resolve([]),
    options.includeRtc && comparisonBounds
      ? rtcSalesRepository.getByProductsInRange(
          storeProductIds,
          comparisonBounds.startDate,
          comparisonBounds.endDate,
        )
      : Promise.resolve([]),
    supplierPriceRepository.listActiveMappings(productIds, selectedSupplierIds),
    Promise.all(
      [...productsByStore.entries()].map(([storeId, rows]) =>
        loadBarcodesByStoreProduct(
          storeId,
          rows.map((row) => row.storeProduct.id),
        ),
      ),
    ),
  ]);

  const latestPrices = await supplierPriceRepository.getLatestPricesForSupplierProducts(
    mappings.map((mapping) => mapping.id),
    order.bookStockDate,
  );

  const salesByProductAndDate = buildDailySalesByProductMap(salesRows);
  const wastageByProductAndDate = qtyMapFromRows(
    wastageRows.map((row) => ({
      storeProductId: row.storeProductId,
      date: row.wastageDate,
      qty: row.wastageQty,
    })),
  );
  const rtcByProductAndDate = qtyMapFromRows(
    rtcRows.map((row) => ({
      storeProductId: row.storeProductId,
      date: row.rtcDate,
      qty: row.rtcQty,
    })),
  );

  const mappingByProductSupplier = new Map<string, (typeof mappings)[number]>();
  for (const mapping of mappings) {
    const key = `${mapping.productId}|${mapping.supplierId}`;
    if (!mappingByProductSupplier.has(key)) {
      mappingByProductSupplier.set(key, mapping);
    }
  }

  const barcodes = new Map<number, string>();
  for (const storeBarcodes of storeBarcodeMaps) {
    for (const [storeProductId, barcode] of storeBarcodes) {
      barcodes.set(storeProductId, barcode);
    }
  }

  const comparisonPeriodDays = averageComparisonPeriodDays(comparisonRanges);
  const shortfallDays = totalUniquePeriodDays(options.shortfallPeriods);
  const forecastService = new WeekdayHistoricalForecastService();
  const periodRanges = periods.map((period) => ({
    startDate: new Date(period.startDate),
    endDate: new Date(period.endDate),
  }));

  await orderRepository.clearCalculatedItems(orderId);

  const pendingItems: Array<typeof orderItems.$inferInsert> = [];

  for (const { storeProduct, product } of storeProducts) {
    const dailyByDate = salesByProductAndDate.get(storeProduct.id);
    const salesByKey: Record<string, string> = {};
    const salesDecimals: DecimalType[] = [];

    for (const period of periods) {
      const sold = sumQtyInDateRange(dailyByDate, period.startDate, period.endDate);
      salesByKey[period.periodKey] = decimalToDb(sold);
      salesDecimals.push(sold);
    }

    const baseSoldQty = aggregatePeriodSales(salesDecimals, options.soldQtyMethod);
    const requiredForShortfall = scaleSoldQtyForShortfall({
      baseSoldQty,
      comparisonPeriodDays,
      shortfallDays,
    });

    const wastageQty = options.includeWastage
      ? averagePeriodQty(wastageByProductAndDate.get(storeProduct.id), comparisonRanges)
      : new Decimal(0);
    const rtcQty = options.includeRtc
      ? averagePeriodQty(rtcByProductAndDate.get(storeProduct.id), comparisonRanges)
      : new Decimal(0);

    const futureQty = parseDbDecimal(futureByProduct.get(storeProduct.id) ?? "0");
    const aggregated = {
      bookStockQty: parseDbDecimal(bookStockByProduct.get(storeProduct.id) ?? "0"),
      receivedNotPostedQty: parseDbDecimal(
        notPostedByProduct.get(storeProduct.id) ?? "0",
      ),
      futureDeliveryEvents: [] as StockEvent[],
    };
    const currentStock = aggregated.bookStockQty
      .plus(aggregated.receivedNotPostedQty)
      .plus(futureQty);

    const simulation = await runSimulationWithForecast({
      bookStockDate: order.bookStockDate,
      clientDeliveryDate: order.deliveryDate,
      storeProductId: storeProduct.id,
      aggregated,
      historicalMap: historicalMapFromDaily(dailyByDate),
      periodRanges,
      forecastService,
    });

    // RTC and wastage are historical metrics, not additional demand.
    // Current stock comes from a stock snapshot and already reflects movements
    // posted before that snapshot. Adding these again double-counts losses.
    // RTC sales are also typically included in daily sales totals.
    const suggestedOrderQty = roundOrderQty(
      calculateOrderSheetSuggestedQty({
        requiredQuantityForShortfall: requiredForShortfall,
        currentStock,
        wastageQty,
        rtcQty,
        includeWastage: false,
        includeRtc: false,
      }),
    );

    const periodSales = toPeriodSalesRows(
      salesByKey,
      periods.map((period) => period.periodKey),
    );

    const dailySalesValues = dailySalesForProductInRange(
      salesByProductAndDate,
      storeProduct.id,
      dayBySalesDates,
    );

    const supplierInputs = selectedSuppliers.map(({ supplier }) => {
      const mapping = mappingByProductSupplier.get(`${product.id}|${supplier.id}`);
      const price = mapping ? latestPrices.get(mapping.id) : undefined;
      return {
        supplierId: supplier.id,
        supplierKey: supplier.code,
        supplierCode: mapping?.supplierCode ?? "",
        supplierName: supplier.name,
        priceTiePriority: supplier.priceTiePriority,
        hasMapping: Boolean(mapping),
        netPrice: price?.netPrice ?? null,
        caseSize: price?.caseSize ?? null,
      };
    });

    const priceComparison = compareSupplierPrices(supplierInputs, suggestedOrderQty);

    const breakdown = {
      ...simulation.stages,
      orderSheet: {
        soldQtyMethod: options.soldQtyMethod,
        includeWastage: options.includeWastage,
        includeRtc: options.includeRtc,
        shortfallDays,
        comparisonPeriodDays,
        baseSoldQty: decimalToDb(baseSoldQty),
        requiredForShortfall: decimalToDb(requiredForShortfall),
        wastageQty: decimalToDb(wastageQty),
        rtcQty: decimalToDb(rtcQty),
        calculatedSoldQty: decimalToDb(baseSoldQty),
        barcode: barcodes.get(storeProduct.id) ?? null,
        dailySales: dayBySalesDates.map((date, index) => ({
          date,
          soldQty: dailySalesValues[index] ?? "0",
        })),
        supplierPrices: priceComparison.snapshots,
      },
    };

    pendingItems.push({
      orderId,
      storeProductId: storeProduct.id,
      periodSales,
      supplierQuotes: toOrderItemSupplierQuotes(priceComparison.snapshots),
      highestSoldQty: decimalToDb(baseSoldQty),
      bookStockQty: decimalToDb(aggregated.bookStockQty),
      receivedNotPostedQty: decimalToDb(aggregated.receivedNotPostedQty),
      futureDeliveryTotalQty: decimalToDb(futureQty),
      forecastSalesQty: decimalToDb(simulation.totalForecastSales),
      shortageQty: decimalToDb(simulation.totalShortage),
      projectedFinalStockQty: decimalToDb(simulation.projectedFinalStock),
      suggestedOrderQty: decimalToDb(suggestedOrderQty),
      finalOrderQty: decimalToDb(suggestedOrderQty),
      priceStatus: priceComparison.priceStatus,
      cheapestSupplierId: priceComparison.cheapestSupplierId,
      cheapestNetPrice: priceComparison.cheapestNetPrice
        ? decimalToDb(priceComparison.cheapestNetPrice)
        : null,
      estimatedLineCost: priceComparison.estimatedLineCost
        ? decimalToDb(priceComparison.estimatedLineCost)
        : null,
      calculationBreakdown: breakdown,
      warning: priceComparison.warning,
    });
  }

  const inserted = await orderRepository.insertOrderItems(pendingItems);
  const snapshotRows = inserted.flatMap((row) =>
    (row.supplierQuotes ?? []).map((quote) => ({
      orderItemId: row.id,
      supplierId: quote.supplierId,
      supplierCode: quote.supplierProductCode,
      netPrice: quote.netPrice,
      caseSize: quote.caseSize,
      priceValidationStatus: quote.priceValidationStatus,
      isCheapest: quote.isCheapest,
      failureReason: quote.failureReason,
    })),
  );
  await orderRepository.insertItemSupplierPrices(snapshotRows);
  await orderRepository.update(orderId, { status: "calculated" });
}

async function runSimulationWithForecast(input: {
  bookStockDate: string;
  clientDeliveryDate: string;
  storeProductId: number;
  aggregated: {
    bookStockQty: DecimalType;
    receivedNotPostedQty: DecimalType;
    futureDeliveryEvents: StockEvent[];
  };
  historicalMap: Map<string, DecimalType>;
  periodRanges: Array<{ startDate: Date; endDate: Date }>;
  forecastService: WeekdayHistoricalForecastService;
}) {
  const bookDate = new Date(input.bookStockDate);
  const deliveryDate = new Date(input.clientDeliveryDate);
  const forecastCache = new Map<string, Decimal>();

  const futureEvents = [...input.aggregated.futureDeliveryEvents]
    .filter((event) => event.eventType === "future_delivery")
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());

  let cursor = bookDate;
  const ranges: Array<{ from: Date; to: Date }> = [];

  for (const event of futureEvents) {
    if (event.eventDate > deliveryDate) break;
    ranges.push({ from: cursor, to: event.eventDate });
    cursor = event.eventDate;
  }
  if (cursor < deliveryDate) {
    ranges.push({ from: cursor, to: deliveryDate });
  }

  for (const range of ranges) {
    const value = await input.forecastService.forecastProductSales({
      storeProductId: input.storeProductId,
      fromDate: range.from,
      toDate: range.to,
      historicalSalesByDate: input.historicalMap,
      periodRanges: input.periodRanges,
    });
    forecastCache.set(
      `${range.from.toISOString()}|${range.to.toISOString()}`,
      value,
    );
  }

  return simulateStockTimeline({
    bookStockDate: bookDate,
    clientDeliveryDate: deliveryDate,
    bookStockQty: input.aggregated.bookStockQty,
    receivedNotPostedQty: input.aggregated.receivedNotPostedQty,
    futureDeliveryEvents: input.aggregated.futureDeliveryEvents,
    forecastBetween: (fromDate, toDate) => {
      const key = `${fromDate.toISOString()}|${toDate.toISOString()}`;
      return forecastCache.get(key) ?? new Decimal(0);
    },
  });
}
