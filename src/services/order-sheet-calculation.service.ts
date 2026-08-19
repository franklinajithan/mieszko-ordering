import { db } from "@/db";
import { productBarcodes, supplierProducts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  dailySalesRepository,
  orderRepository,
  rtcSalesRepository,
  supplierPriceRepository,
  wastageRepository,
} from "@/repositories";
import { compareSupplierPrices } from "@/services/supplier-prices/supplier-price.service";
import {
  aggregatePeriodSales,
  averageComparisonPeriodDays,
  buildDailySalesByProductMap,
  calculateOrderSheetSuggestedQty,
  dailySalesForProductInRange,
  diffDaysInclusive,
  listDatesInclusive,
  parseQty,
  roundOrderQty,
  scaleSoldQtyForShortfall,
} from "@/utils/orderSheetCalculations";
import { Decimal, decimalToDb, parseDbDecimal, type Decimal as DecimalType } from "@/utils/decimal";
import type { OrderSheetMetadata, SoldQtyMethod } from "@/types/orderSheet";
import {
  aggregateStockQuantities,
  simulateStockTimeline,
  stockEventFromDb,
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

function toPeriodColumns(periodKeys: string[], salesByKey: Record<string, string>) {
  return {
    period1: salesByKey.period_1 ?? "0",
    period2: salesByKey.period_2 ?? "0",
    period3: salesByKey.period_3 ?? "0",
    previousYear: salesByKey.previous_year ?? "0",
    extra: periodKeys
      .filter((key) => !["period_1", "period_2", "period_3", "previous_year"].includes(key))
      .map((key) => ({ periodKey: key, soldQty: salesByKey[key] ?? "0" })),
  };
}

async function loadBarcodesByStoreProduct(
  storeId: number,
  storeProductIds: number[],
): Promise<Map<number, string>> {
  if (!storeProductIds.length) return new Map();
  const rows = await db
    .select({
      storeProductId: productBarcodes.storeProductId,
      barcode: productBarcodes.barcode,
    })
    .from(productBarcodes)
    .where(
      and(
        eq(productBarcodes.storeId, storeId),
        inArray(productBarcodes.storeProductId, storeProductIds),
      ),
    );
  const map = new Map<number, string>();
  for (const row of rows) {
    if (!map.has(row.storeProductId)) {
      map.set(row.storeProductId, row.barcode);
    }
  }
  return map;
}

export async function calculateOrderSheet(
  orderId: number,
  options: OrderSheetCalculationOptions,
): Promise<void> {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const periods = (await orderRepository.getPeriods(orderId)).sort(
    (a, b) => periodSortKey(a.periodKey) - periodSortKey(b.periodKey),
  );
  if (!periods.length) {
    throw new Error("Add at least one comparison period");
  }

  const selectedSuppliers = await orderRepository.getSelectedSuppliers(orderId);
  if (!selectedSuppliers.length) {
    throw new Error("Select at least one supplier");
  }

  const departmentIds = (order.departmentFilters ?? [])
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!departmentIds.length) {
    throw new Error("Select at least one department");
  }

  const storeIds = options.storeIds?.length ? options.storeIds : [order.storeId];
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

  const stockRows = await orderRepository.getStockEvents(orderId);
  const stockByProduct = new Map<number, StockEvent[]>();
  for (const row of stockRows) {
    if (!row.item) continue;
    const list = stockByProduct.get(row.item.storeProductId) ?? [];
    list.push(
      stockEventFromDb({
        eventType: row.event.eventType,
        eventDate: row.event.eventDate,
        quantity: row.item.quantity,
        sortOrder: row.event.sortOrder,
      }),
    );
    stockByProduct.set(row.item.storeProductId, list);
  }

  const comparisonPeriodDays = averageComparisonPeriodDays(
    periods.map((period) => ({
      startDate: period.startDate,
      endDate: period.endDate,
    })),
  );
  const shortfallDays = diffDaysInclusive(
    options.shortfallStartDate,
    options.shortfallEndDate,
  );

  const forecastService = new WeekdayHistoricalForecastService();
  const periodRanges = periods.map((period) => ({
    startDate: new Date(period.startDate),
    endDate: new Date(period.endDate),
  }));

  await orderRepository.clearCalculatedItems(orderId);

  const productsByStore = new Map<number, typeof storeProducts>();
  for (const row of storeProducts) {
    const storeId = row.storeProduct.storeId;
    const list = productsByStore.get(storeId) ?? [];
    list.push(row);
    productsByStore.set(storeId, list);
  }

  const barcodes = new Map<number, string>();
  for (const [storeId, rows] of productsByStore) {
    const storeBarcodes = await loadBarcodesByStoreProduct(
      storeId,
      rows.map((row) => row.storeProduct.id),
    );
    for (const [storeProductId, barcode] of storeBarcodes) {
      barcodes.set(storeProductId, barcode);
    }
  }

  const dayBySalesDates =
    options.dayBySalesRequired &&
    options.dayBySalesStartDate &&
    options.dayBySalesEndDate
      ? listDatesInclusive(options.dayBySalesStartDate, options.dayBySalesEndDate)
      : [];

  const salesByProductAndDate = dayBySalesDates.length
    ? buildDailySalesByProductMap(
        await dailySalesRepository.getSalesByProductsInRange(
          storeProducts.map((row) => row.storeProduct.id),
          options.dayBySalesStartDate!,
          options.dayBySalesEndDate!,
        ),
      )
    : new Map<number, Map<string, string>>();

  for (const { storeProduct, product } of storeProducts) {
    const salesByKey: Record<string, string> = {};
    const salesDecimals: DecimalType[] = [];

    for (const period of periods) {
      const sold = await dailySalesRepository.sumSalesInPeriod(
        storeProduct.id,
        period.startDate,
        period.endDate,
      );
      salesByKey[period.periodKey] = sold;
      salesDecimals.push(parseDbDecimal(sold));
    }

    const baseSoldQty = aggregatePeriodSales(salesDecimals, options.soldQtyMethod);
    const requiredForShortfall = scaleSoldQtyForShortfall({
      baseSoldQty,
      comparisonPeriodDays,
      shortfallDays,
    });

    let wastageQty = new Decimal(0);
    let rtcQty = new Decimal(0);

    if (options.includeWastage) {
      for (const period of periods) {
        const total = await wastageRepository.sumInPeriod(
          storeProduct.id,
          period.startDate,
          period.endDate,
        );
        wastageQty = wastageQty.plus(parseQty(total));
      }
      if (periods.length > 1) {
        wastageQty = wastageQty.div(periods.length);
      }
    }

    if (options.includeRtc) {
      for (const period of periods) {
        const total = await rtcSalesRepository.sumInPeriod(
          storeProduct.id,
          period.startDate,
          period.endDate,
        );
        rtcQty = rtcQty.plus(parseQty(total));
      }
      if (periods.length > 1) {
        rtcQty = rtcQty.div(periods.length);
      }
    }

    const productEvents = stockByProduct.get(storeProduct.id) ?? [];
    const aggregated = aggregateStockQuantities(productEvents);
    const currentStock = aggregated.bookStockQty
      .plus(aggregated.receivedNotPostedQty)
      .plus(aggregated.futureDeliveryTotal);

    const salesRows = await dailySalesRepository.getSalesForProduct(storeProduct.id);
    const historicalMap = buildHistoricalSalesMap(
      salesRows.map((sale) => ({
        salesDate: sale.salesDate,
        soldQty: sale.soldQty,
      })),
    );

    const simulation = await runSimulationWithForecast({
      bookStockDate: order.bookStockDate,
      clientDeliveryDate: order.clientDeliveryDate,
      storeProductId: storeProduct.id,
      aggregated,
      historicalMap,
      periodRanges,
      forecastService,
    });

    const suggestedOrderQty = roundOrderQty(
      calculateOrderSheetSuggestedQty({
        requiredQuantityForShortfall: requiredForShortfall,
        currentStock: aggregated.bookStockQty,
        wastageQty,
        rtcQty,
        includeWastage: options.includeWastage,
        includeRtc: options.includeRtc,
      }),
    );

    const periodColumns = toPeriodColumns(
      periods.map((period) => period.periodKey),
      salesByKey,
    );

    const dailySalesValues = dailySalesForProductInRange(
      salesByProductAndDate,
      storeProduct.id,
      dayBySalesDates,
    );

    const supplierInputs = await Promise.all(
      selectedSuppliers.map(async ({ supplier }) => {
        const [mapping] = await db
          .select()
          .from(supplierProducts)
          .where(
            and(
              eq(supplierProducts.productId, product.id),
              eq(supplierProducts.supplierId, supplier.id),
              eq(supplierProducts.isActive, true),
            ),
          );

        let netPrice: string | null = null;
        if (mapping) {
          const price = await supplierPriceRepository.getLatestPrice(
            mapping.id,
            order.bookStockDate,
          );
          netPrice = price?.netPrice ?? null;
        }

        return {
          supplierId: supplier.id,
          supplierCode: mapping?.supplierCode ?? "",
          supplierName: supplier.name,
          priceTiePriority: supplier.priceTiePriority,
          hasMapping: Boolean(mapping),
          netPrice,
        };
      }),
    );

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
        extraPeriodSales: periodColumns.extra,
        barcode: barcodes.get(storeProduct.id) ?? null,
        dailySales: dayBySalesDates.map((date, index) => ({
          date,
          soldQty: dailySalesValues[index] ?? "0",
        })),
      },
    };

    const [orderItem] = await orderRepository.insertOrderItems([
      {
        orderId,
        storeProductId: storeProduct.id,
        period1Sales: periodColumns.period1,
        period2Sales: periodColumns.period2,
        period3Sales: periodColumns.period3,
        previousYearSales: periodColumns.previousYear,
        highestSoldQty: decimalToDb(baseSoldQty),
        bookStockQty: decimalToDb(aggregated.bookStockQty),
        receivedNotPostedQty: decimalToDb(aggregated.receivedNotPostedQty),
        futureDeliveryTotalQty: decimalToDb(simulation.futureDeliveryTotal),
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
      },
    ]);

    await orderRepository.insertItemSupplierPrices(
      priceComparison.snapshots.map((snapshot) => ({
        orderItemId: orderItem.id,
        supplierId: snapshot.supplierId,
        supplierCode: snapshot.supplierCode,
        netPrice: snapshot.netPrice,
        priceValidationStatus: snapshot.priceValidationStatus,
        isCheapest: snapshot.isCheapest,
        failureReason: snapshot.failureReason,
      })),
    );
  }

  await orderRepository.update(orderId, { status: "calculated" });
}

async function runSimulationWithForecast(input: {
  bookStockDate: string;
  clientDeliveryDate: string;
  storeProductId: number;
  aggregated: ReturnType<typeof aggregateStockQuantities>;
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
