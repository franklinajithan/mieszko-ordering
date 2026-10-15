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
import { isIsoDateString } from "@/utils/iso-date";
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
  const selectedSuppliers = [...new Map(
    supplierRows.map((supplier) => [supplier.id, { supplier }] as const),
  ).values()];
  if (!selectedSuppliers.length) {
    throw new Error("Select at least one supplier");
  }

  const departmentIds = (order.departmentIds ?? []).filter(
    (id) => Number.isInteger(id) && id > 0,
  );

  const storeIds = options.storeIds?.length ? options.storeIds : order.storeIds;
  if (!storeIds.length) {
    throw new Error("Select at least one store before generating an order");
  }
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

  // Deduplicate store products before loading feed rows and saving order lines.
  const uniqueStoreProducts = [...new Map(
    storeProducts.map((row) => [row.storeProduct.id, row] as const),
  ).values()];
  const storeProductIds = uniqueStoreProducts.map((row) => row.storeProduct.id);
  const productIds = [...new Set(uniqueStoreProducts.map((row) => row.product.id))];
  const selectedSupplierIds = selectedSuppliers.map(({ supplier }) => supplier.id);
  const comparisonRanges = periods.map((period) => ({
    startDate: period.startDate,
    endDate: period.endDate,
  }));
  if (comparisonRanges.some((range) =>
    !isIsoDateString(range.startDate) ||
    !isIsoDateString(range.endDate) ||
    range.endDate < range.startDate
  )) {
    throw new Error("Every comparison period needs a valid start and end date");
  }
  const comparisonBounds = boundingIsoRange(comparisonRanges);
  if (!comparisonBounds) {
    throw new Error("Comparison periods must have valid start and end dates");
  }
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
  for (const row of uniqueStoreProducts) {
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
    options.includeBookStock !== false ? bookStockRepository.latestQtyByStoreProductIds(storeProductIds) : Promise.resolve(new Map<number, string>()),
    options.includeBookStock !== false ? notPostedDeliveryRepository.sumQtyByStoreProductIds(storeProductIds) : Promise.resolve(new Map<number, string>()),
    options.includeFutureDeliveries ? futureDeliveryRepository.listScheduledByStoreProductIds(storeProductIds) : Promise.resolve([]),
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

  const undatedFutureCount = futureByProduct.filter(
    (row) => !row.expectedDeliveryDate && !parseDbDecimal(row.quantity).isZero(),
  ).length;
  if (undatedFutureCount > 0) {
    throw new Error(
      `Cannot calculate safely: ${undatedFutureCount} future-delivery lines lack expected arrival dates. Set their delivery dates before generating.`,
    );
  }
  // Validate every incoming line before replacing any existing calculated items.
  // A dated upload outside the forecast horizon is allowed and ignored later.
  const invalidFutureRows = futureByProduct.filter((row) =>
    !parseDbDecimal(row.quantity).isFinite() ||
    parseDbDecimal(row.quantity).isNegative() ||
    (row.expectedDeliveryDate !== null &&
      !isIsoDateString(row.expectedDeliveryDate))
  );
  if (invalidFutureRows.length) {
    throw new Error(
      `Cannot calculate safely: ${invalidFutureRows.length} future-delivery lines have invalid dates or quantities.`,
    );
  }
  // Without a book-stock snapshot, use the order date as the forecast
  // anchor. A historical book-stock date must not pull old deliveries into
  // a stock-free order calculation.
  const stockAnchorDate = options.includeBookStock !== false
    ? order.bookStockDate
    : order.orderDate;
  if (order.deliveryDate <= stockAnchorDate) {
    throw new Error("Delivery date must be after the stock forecast anchor date.");
  }
  const futureLinesByProduct = new Map<number, typeof futureByProduct>();
  for (const row of futureByProduct) {
    const lines = futureLinesByProduct.get(row.storeProductId) ?? [];
    lines.push(row);
    futureLinesByProduct.set(row.storeProductId, lines);
  }

  const latestPrices = await supplierPriceRepository.getLatestPricesForSupplierProducts(
    mappings.map((mapping) => mapping.id),
    order.orderDate,
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

  // Prepare all calculations before touching previously saved order items.
  const pendingItems: Array<typeof orderItems.$inferInsert> = [];

  for (const { storeProduct, product } of uniqueStoreProducts) {
    const dailyByDate = salesByProductAndDate.get(storeProduct.id);
    const salesByKey: Record<string, string> = {};
    const salesDecimals: DecimalType[] = [];

    for (const period of periods) {
      const sold = sumQtyInDateRange(dailyByDate, period.startDate, period.endDate);
      salesByKey[period.periodKey] = decimalToDb(sold);
      salesDecimals.push(sold);
    }

    // CRM normal sales and RTC sales are separate feeds: RTC is NOT
    // contained in normal sales. Combine only when the user enables RTC.
    const baseSoldQty = aggregatePeriodSales(salesDecimals, options.soldQtyMethod);
    const rtcByDate = rtcByProductAndDate.get(storeProduct.id);
    const rtcQty = options.includeRtc
      ? aggregatePeriodSales(
          periods.map((period) => sumQtyInDateRange(rtcByDate, period.startDate, period.endDate)),
          options.soldQtyMethod,
        )
      : new Decimal(0);
    const wastageQty = options.includeWastage
      ? averagePeriodQty(wastageByProductAndDate.get(storeProduct.id), comparisonRanges)
      : new Decimal(0);
    const requiredForShortfall = scaleSoldQtyForShortfall({
      baseSoldQty: baseSoldQty.plus(rtcQty).plus(wastageQty),
      comparisonPeriodDays,
      shortfallDays,
    });
    // Include RTC in the stock-depletion forecast, not only in the
    // post-delivery demand target; otherwise projected stock is overstated.
    const movementByDate = new Map(dailyByDate ?? []);
    if (options.includeRtc && rtcByDate) {
      for (const [date, qty] of rtcByDate) {
        movementByDate.set(
          date,
          decimalToDb(parseDbDecimal(movementByDate.get(date) ?? "0").plus(parseDbDecimal(qty))),
        );
      }
    }
    // Wastage is physical stock leaving the store. Include its historical
    // movement in the pre-delivery depletion forecast when enabled, while
    // retaining a separate wastage feed and separate breakdown figures.
    const wastageByDate = wastageByProductAndDate.get(storeProduct.id);
    if (options.includeWastage && wastageByDate) {
      for (const [date, qty] of wastageByDate) {
        movementByDate.set(
          date,
          decimalToDb(parseDbDecimal(movementByDate.get(date) ?? "0").plus(parseDbDecimal(qty))),
        );
      }
    }

    const futureEvents: StockEvent[] = (futureLinesByProduct.get(storeProduct.id) ?? [])
      .filter((row) => row.expectedDeliveryDate && row.expectedDeliveryDate > stockAnchorDate && row.expectedDeliveryDate <= order.deliveryDate)
      .map((row, index) => ({
        eventType: "future_delivery" as const,
        eventDate: new Date(row.expectedDeliveryDate + "T00:00:00Z"),
        quantity: parseDbDecimal(row.quantity),
        sortOrder: index,
      }));
    const futureQty = futureEvents.reduce((sum, event) => sum.plus(event.quantity), new Decimal(0));
    const aggregated = {
      bookStockQty: parseDbDecimal(bookStockByProduct.get(storeProduct.id) ?? "0"),
      receivedNotPostedQty: parseDbDecimal(
        notPostedByProduct.get(storeProduct.id) ?? "0",
      ),
      futureDeliveryEvents: futureEvents,
    };
    const currentStock = aggregated.bookStockQty
      .plus(aggregated.receivedNotPostedQty)
      .plus(futureQty);

    const simulation = await runSimulationWithForecast({
      bookStockDate: stockAnchorDate,
      clientDeliveryDate: order.deliveryDate,
      storeProductId: storeProduct.id,
      aggregated,
      historicalMap: historicalMapFromDaily(movementByDate),
      periodRanges,
      forecastService,
    });

    // RTC is separate from normal sales and already included in the
    // required demand above. Do not add it a second time here.
    // Historical losses before the book-stock snapshot are not subtracted
    // again from that snapshot.
    const stockAtClientDelivery = simulation.projectedFinalStock;
    // Negative projected stock represents unmet demand before the supplier
    // delivery. That shortage cannot be recovered by stock arriving later:
    // only the nonnegative on-hand balance is available for the new coverage
    // window. Keep the shortage visible in the simulation breakdown.
    const availableAtDelivery = Decimal.max(stockAtClientDelivery, new Decimal(0));
    const suggestedOrderQty = roundOrderQty(
      calculateOrderSheetSuggestedQty({
        requiredQuantityForShortfall: requiredForShortfall,
        currentStock: availableAtDelivery,
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
        hasMapping: Boolean(mapping?.supplierCode?.trim()),
        netPrice: price?.netPrice ?? null,
        caseSize: price?.caseSize ?? null,
      };
    });

    const priceComparison = compareSupplierPrices(supplierInputs, suggestedOrderQty);

    const breakdown = {
      stages: simulation.stages,
      orderSheet: {
        soldQtyMethod: options.soldQtyMethod,
        includeWastage: options.includeWastage,
        includeRtc: options.includeRtc,
        shortfallDays,
        comparisonPeriodDays,
        baseSoldQty: decimalToDb(baseSoldQty),
        requiredForShortfall: decimalToDb(requiredForShortfall),
        normalSalesQty: decimalToDb(baseSoldQty),
        separateRtcSalesQty: decimalToDb(rtcQty),
        historicalWastageQty: decimalToDb(wastageQty),
        demandIncludesRtc: options.includeRtc,
        demandIncludesWastage: options.includeWastage,
        stockAtClientDelivery: decimalToDb(stockAtClientDelivery),
        physicalStockIncludingFuture: decimalToDb(currentStock),
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

  await orderRepository.replaceCalculatedItems(orderId, pendingItems);
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
  const bookDate = new Date(`${input.bookStockDate}T00:00:00Z`);
  const deliveryDate = new Date(`${input.clientDeliveryDate}T00:00:00Z`);
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
