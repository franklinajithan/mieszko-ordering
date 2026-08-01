import { db } from "@/db";
import { supplierProducts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  dailySalesRepository,
  orderRepository,
  supplierPriceRepository,
} from "@/repositories";
import { calculateHighestSoldQty } from "@/services/highest-sales.service";
import {
  buildHistoricalSalesMap,
  WeekdayHistoricalForecastService,
} from "@/services/sales-forecast.service";
import { calculateSuggestedOrderQty } from "@/services/suggested-order.service";
import {
  aggregateStockQuantities,
  simulateStockTimeline,
  stockEventFromDb,
  type StockEvent,
} from "@/services/stock-simulation.service";
import { compareSupplierPrices } from "@/services/supplier-price.service";
import { decimalToDb, parseDbDecimal, type Decimal } from "@/utils/decimal";
import type { PeriodKey } from "@/types";

export async function calculateOrder(orderId: number) {
  const order = await orderRepository.getById(orderId);
  if (!order) throw new Error("Order not found");

  const periods = await orderRepository.getPeriods(orderId);
  const selectedSuppliers = await orderRepository.getSelectedSuppliers(orderId);
  if (!selectedSuppliers.length) {
    throw new Error("Select at least one supplier for price comparison");
  }

  const departmentIds = (order.departmentFilters ?? [])
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0);

  const storeProducts = await orderRepository.getStoreProductsForOrder(
    order.storeId,
    departmentIds,
  );

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

  const forecastService = new WeekdayHistoricalForecastService();
  const periodRanges = periods.map((p) => ({
    startDate: new Date(p.startDate),
    endDate: new Date(p.endDate),
  }));

  await db.transaction(async () => {
    await orderRepository.clearCalculatedItems(orderId);

    for (const { storeProduct, product } of storeProducts) {
      const periodSales: Record<PeriodKey, string> = {
        period_1: "0",
        period_2: "0",
        period_3: "0",
        previous_year: "0",
      };

      for (const period of periods) {
        periodSales[period.periodKey as PeriodKey] =
          await dailySalesRepository.sumSalesInPeriod(
            storeProduct.id,
            period.startDate,
            period.endDate,
          );
      }

      const highestSoldQty = calculateHighestSoldQty({
        period1: parseDbDecimal(periodSales.period_1),
        period2: parseDbDecimal(periodSales.period_2),
        period3: parseDbDecimal(periodSales.period_3),
        previousYear: parseDbDecimal(periodSales.previous_year),
      });

      const productEvents = stockByProduct.get(storeProduct.id) ?? [];
      const aggregated = aggregateStockQuantities(productEvents);

      const salesRows = await dailySalesRepository.getSalesForProduct(
        storeProduct.id,
      );
      const historicalMap = buildHistoricalSalesMap(
        salesRows.map((s) => ({
          salesDate: s.salesDate,
          soldQty: s.soldQty,
        })),
      );

      const syncSimulation = await runSimulationWithAsyncForecast({
        bookStockDate: order.bookStockDate,
        clientDeliveryDate: order.clientDeliveryDate,
        storeProductId: storeProduct.id,
        aggregated,
        historicalMap,
        periodRanges,
        forecastService,
      });

      const suggestedOrderQty = calculateSuggestedOrderQty(
        highestSoldQty,
        syncSimulation.projectedFinalStock,
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

      const priceComparison = compareSupplierPrices(
        supplierInputs,
        suggestedOrderQty,
      );

      const [orderItem] = await orderRepository.insertOrderItems([
        {
          orderId,
          storeProductId: storeProduct.id,
          period1Sales: periodSales.period_1,
          period2Sales: periodSales.period_2,
          period3Sales: periodSales.period_3,
          previousYearSales: periodSales.previous_year,
          highestSoldQty: decimalToDb(highestSoldQty),
          bookStockQty: decimalToDb(aggregated.bookStockQty),
          receivedNotPostedQty: decimalToDb(aggregated.receivedNotPostedQty),
          futureDeliveryTotalQty: decimalToDb(
            syncSimulation.futureDeliveryTotal,
          ),
          forecastSalesQty: decimalToDb(syncSimulation.totalForecastSales),
          shortageQty: decimalToDb(syncSimulation.totalShortage),
          projectedFinalStockQty: decimalToDb(
            syncSimulation.projectedFinalStock,
          ),
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
          calculationBreakdown: syncSimulation.stages,
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
  });
}

async function runSimulationWithAsyncForecast(input: {
  bookStockDate: string;
  clientDeliveryDate: string;
  storeProductId: number;
  aggregated: ReturnType<typeof aggregateStockQuantities>;
  historicalMap: Map<string, Decimal>;
  periodRanges: Array<{ startDate: Date; endDate: Date }>;
  forecastService: WeekdayHistoricalForecastService;
}) {
  const {
    bookStockDate,
    clientDeliveryDate,
    storeProductId,
    aggregated,
    historicalMap,
    periodRanges,
    forecastService,
  } = input;

  const forecastCache = new Map<string, Decimal>();
  const bookDate = new Date(bookStockDate);
  const deliveryDate = new Date(clientDeliveryDate);

  const futureEvents = [...aggregated.futureDeliveryEvents]
    .filter((e) => e.eventType === "future_delivery")
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
    const value = await forecastService.forecastProductSales({
      storeProductId,
      fromDate: range.from,
      toDate: range.to,
      historicalSalesByDate: historicalMap,
      periodRanges,
    });
    forecastCache.set(
      `${range.from.toISOString()}|${range.to.toISOString()}`,
      value,
    );
  }

  return simulateStockTimeline({
    bookStockDate: bookDate,
    clientDeliveryDate: deliveryDate,
    bookStockQty: aggregated.bookStockQty,
    receivedNotPostedQty: aggregated.receivedNotPostedQty,
    futureDeliveryEvents: aggregated.futureDeliveryEvents,
    forecastBetween: (fromDate, toDate) => {
      const key = `${fromDate.toISOString()}|${toDate.toISOString()}`;
      return forecastCache.get(key) ?? forecastCache.values().next().value!;
    },
  });
}
