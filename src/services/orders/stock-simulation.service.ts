import { Decimal, toDecimal } from "@/utils/decimal";

export type StockEvent = {
  eventType: "book_stock" | "received_not_posted" | "future_delivery";
  eventDate: Date;
  quantity: Decimal;
  sortOrder: number;
};

export type StockSimulationInput = {
  bookStockDate: Date;
  clientDeliveryDate: Date;
  bookStockQty: Decimal;
  receivedNotPostedQty: Decimal;
  futureDeliveryEvents: StockEvent[];
  forecastBetween: (fromDate: Date, toDate: Date) => Decimal;
};

export type StockStage = {
  stage: string;
  eventDate: string;
  stockBefore: string;
  forecastSales: string;
  shortage: string;
  stockAfterForecast: string;
  deliveryAdded: string;
  stockAfter: string;
};

export type StockSimulationResult = {
  projectedFinalStock: Decimal;
  totalForecastSales: Decimal;
  totalShortage: Decimal;
  futureDeliveryTotal: Decimal;
  stages: StockStage[];
};

function formatStageDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Event-based stock simulation. Pure function with no DB access.
 */
export function simulateStockTimeline(
  input: StockSimulationInput,
): StockSimulationResult {
  let stock = input.bookStockQty.plus(input.receivedNotPostedQty);
  let totalForecast = new Decimal(0);
  let totalShortage = new Decimal(0);
  let futureDeliveryTotal = new Decimal(0);
  const stages: StockStage[] = [];

  stages.push({
    stage: "opening",
    eventDate: formatStageDate(input.bookStockDate),
    stockBefore: input.bookStockQty.toString(),
    forecastSales: "0",
    shortage: "0",
    stockAfterForecast: stock.toString(),
    deliveryAdded: input.receivedNotPostedQty.toString(),
    stockAfter: stock.toString(),
  });

  const futureEvents = [...input.futureDeliveryEvents]
    .filter((e) => e.eventType === "future_delivery")
    .sort((a, b) => {
      const dateDiff = a.eventDate.getTime() - b.eventDate.getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.sortOrder - b.sortOrder;
    });

  let cursor = input.bookStockDate;

  for (const event of futureEvents) {
    if (event.eventDate > input.clientDeliveryDate) break;

    const forecast = input.forecastBetween(cursor, event.eventDate);
    totalForecast = totalForecast.plus(forecast);

    const stockBefore = stock;
    stock = stock.minus(forecast);

    let shortage = new Decimal(0);
    if (stock.isNegative()) {
      shortage = stock.abs();
      totalShortage = totalShortage.plus(shortage);
      stock = new Decimal(0);
    }

    futureDeliveryTotal = futureDeliveryTotal.plus(event.quantity);
    stock = stock.plus(event.quantity);

    stages.push({
      stage: "future_delivery",
      eventDate: formatStageDate(event.eventDate),
      stockBefore: stockBefore.toString(),
      forecastSales: forecast.toString(),
      shortage: shortage.toString(),
      stockAfterForecast: stockBefore.minus(forecast).isNegative()
        ? "0"
        : stockBefore.minus(forecast).toString(),
      deliveryAdded: event.quantity.toString(),
      stockAfter: stock.toString(),
    });

    cursor = event.eventDate;
  }

  if (cursor < input.clientDeliveryDate) {
    const forecast = input.forecastBetween(cursor, input.clientDeliveryDate);
    totalForecast = totalForecast.plus(forecast);

    const stockBefore = stock;
    stock = stock.minus(forecast);

    let shortage = new Decimal(0);
    if (stock.isNegative()) {
      shortage = stock.abs();
      totalShortage = totalShortage.plus(shortage);
      stock = new Decimal(0);
    }

    stages.push({
      stage: "to_client_delivery",
      eventDate: formatStageDate(input.clientDeliveryDate),
      stockBefore: stockBefore.toString(),
      forecastSales: forecast.toString(),
      shortage: shortage.toString(),
      stockAfterForecast: stock.toString(),
      deliveryAdded: "0",
      stockAfter: stock.toString(),
    });
  }

  return {
    projectedFinalStock: stock,
    totalForecastSales: totalForecast,
    totalShortage: totalShortage,
    futureDeliveryTotal,
    stages,
  };
}

export function aggregateStockQuantities(events: StockEvent[]): {
  bookStockQty: Decimal;
  receivedNotPostedQty: Decimal;
  futureDeliveryEvents: StockEvent[];
} {
  let bookStockQty = new Decimal(0);
  let receivedNotPostedQty = new Decimal(0);
  const futureDeliveryEvents: StockEvent[] = [];

  for (const event of events) {
    if (event.eventType === "book_stock") {
      bookStockQty = bookStockQty.plus(event.quantity);
    } else if (event.eventType === "received_not_posted") {
      receivedNotPostedQty = receivedNotPostedQty.plus(event.quantity);
    } else {
      futureDeliveryEvents.push(event);
    }
  }

  return { bookStockQty, receivedNotPostedQty, futureDeliveryEvents };
}

export function stockEventFromDb(row: {
  eventType: string;
  eventDate: string;
  quantity: string;
  sortOrder: number;
}): StockEvent {
  return {
    eventType: row.eventType as StockEvent["eventType"],
    eventDate: new Date(row.eventDate),
    quantity: toDecimal(row.quantity),
    sortOrder: row.sortOrder,
  };
}
