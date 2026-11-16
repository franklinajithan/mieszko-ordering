import "server-only";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { admOrders, admShopAssortments, crmProductCodeAliases, productBarcodes, storeProducts, stores } from "@/db/schema";
import { dailySalesRepository } from "@/repositories/daily-sales";
import { Decimal } from "@/utils/decimal";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import type { AdmCatalogItem } from "./types";

export async function getAdmAssortment(storeId: number, catalog: AdmCatalogItem[]) {
  const [saved] = await db.select({ items: admShopAssortments.items })
    .from(admShopAssortments).where(eq(admShopAssortments.storeId, storeId));
  const items = saved?.items;
  return Object.fromEntries(catalog.flatMap(({ name, code }) =>
    !items ? [[name, code]] : Object.hasOwn(items, name) ? [[name, items[name]]] : [],
  ));
}

export async function getAdmOrder(
  storeId: number,
  catalog: AdmCatalogItem[],
  deliveryDate: string,
  workbookOrderDate: string | null,
) {
  const today = todayIso();
  const salesEnd = deliveryDate < today ? deliveryDate : today;
  const dates = Array.from({ length: 10 }, (_, index) => addDaysIso(salesEnd, index - 10));
  const weekday = new Date(`${deliveryDate}T00:00:00Z`).getUTCDay();
  const comparisonDays = weekday === 0 ? 3 : weekday === 3 ? 4 : 0;
  const comparisonDates = Array.from({ length: comparisonDays }, (_, index) => addDaysIso(deliveryDate, index - 14));
  const queryDates = [...dates, ...comparisonDates.filter((date) => date < today)].sort();
  const startDate = queryDates[0];
  const endDate = queryDates[queryDates.length - 1];
  const assortment = await getAdmAssortment(storeId, catalog);
  const codes = Object.values(assortment).filter((code): code is string => Boolean(code));
  const barcodes = catalog.flatMap((item) => item.barcode ? [item.barcode] : []);

  const [currentRows, previousRows, matchedCodes, matchedAliases, matchedBarcodes, daySummaries, submittedShops] = await Promise.all([
    db.select().from(admOrders).where(and(eq(admOrders.storeId, storeId), eq(admOrders.deliveryDate, deliveryDate))),
    db.select().from(admOrders).where(and(eq(admOrders.storeId, storeId), lt(admOrders.deliveryDate, deliveryDate)))
      .orderBy(desc(admOrders.deliveryDate)).limit(2),
    codes.length ? db.select({ code: storeProducts.storeProductCode, id: storeProducts.id }).from(storeProducts)
      .where(and(eq(storeProducts.storeId, storeId), inArray(storeProducts.storeProductCode, codes))) : [],
    codes.length ? db.select({ code: crmProductCodeAliases.identifier, id: storeProducts.id }).from(crmProductCodeAliases)
      .innerJoin(storeProducts, eq(storeProducts.id, crmProductCodeAliases.storeProductId))
      .where(and(eq(crmProductCodeAliases.storeId, storeId), eq(storeProducts.storeId, storeId),
        inArray(crmProductCodeAliases.identifier, codes))) : [],
    barcodes.length ? db.select({ barcode: productBarcodes.barcode, id: storeProducts.id, code: storeProducts.storeProductCode }).from(productBarcodes)
      .innerJoin(storeProducts, eq(storeProducts.id, productBarcodes.storeProductId))
      .where(and(eq(storeProducts.storeId, storeId), eq(productBarcodes.storeId, storeId), inArray(productBarcodes.barcode, barcodes))) : [],
    dailySalesRepository.listDateSummariesForStoresInRange([storeId], startDate, endDate),
    db.select({ name: stores.name }).from(admOrders).innerJoin(stores, eq(stores.id, admOrders.storeId))
      .where(and(eq(admOrders.deliveryDate, deliveryDate), eq(stores.erpType, "msp")))
      .orderBy(stores.name),
  ]);

  const byCode = new Map([...matchedAliases, ...matchedCodes].map((row) => [row.code, row.id]));
  const byBarcode = new Map<string, Map<number, string>>();
  for (const row of matchedBarcodes) {
    if (!byBarcode.has(row.barcode)) byBarcode.set(row.barcode, new Map());
    byBarcode.get(row.barcode)!.set(row.id, row.code);
  }
  const current = currentRows[0];
  const knownNames = new Set(catalog.map(({ name }) => name));
  const savedItemNames = new Set([...Object.keys(current?.quantities ?? {}), ...Object.keys(current?.physicalStock ?? {})]);
  const removedItems = [...savedItemNames].filter((name) => !knownNames.has(name))
    .map((name) => ({ name, code: null, barcode: null, salesUnit: null, previousQty: null }));
  const items = [...catalog, ...removedItems].filter((item) => Object.hasOwn(assortment, item.name)
    || savedItemNames.has(item.name)).map((item) => {
    const code = Object.hasOwn(assortment, item.name) ? assortment[item.name] : item.code;
    const id = code ? byCode.get(code) : undefined;
    if (id !== undefined) return { ...item, code, id };
    const barcodeMatches = item.barcode && code === item.code ? byBarcode.get(item.barcode) : undefined;
    const barcodeMatch = barcodeMatches?.size === 1 ? [...barcodeMatches][0] : undefined;
    return { ...item, code: barcodeMatch?.[1] ?? code, id: barcodeMatch?.[0] };
  });
  const salesRows = await dailySalesRepository.getSalesByProductsInRange(
    items.flatMap(({ id }) => id === undefined ? [] : [id]), startDate, endDate,
  );
  const byItemAndDay = new Map(salesRows.map(({ storeProductId, salesDate, soldQty }) => [
    `${storeProductId}/${salesDate}`, soldQty,
  ]));
  const availableDays = new Set(daySummaries.map(({ salesDate }) => salesDate));

  const previous = previousRows.map(({ deliveryDate, quantities }) => ({
    date: deliveryDate,
    quantities: quantities as Record<string, number | null>,
  }));
  if (workbookOrderDate && workbookOrderDate < deliveryDate && !previous.some((order) => order.date === workbookOrderDate)) {
    previous.push({ date: workbookOrderDate, quantities: Object.fromEntries(catalog.map(({ name, previousQty }) => [name, previousQty])) });
  }
  previous.sort((a, b) => b.date.localeCompare(a.date));
  const history = previous.slice(0, 2);
  return {
    dates, comparisonDates, assortment,
    missingComparisonDates: comparisonDates.filter((date) => !availableDays.has(date)),
    catalog: catalog.map(({ name, code }) => ({ name, code })),
    submittedShops: submittedShops.map(({ name }) => name),
    previousDates: history.map(({ date }) => date),
    missingSalesDates: dates.filter((date) => !availableDays.has(date)),
    current: current ? { quantities: current.quantities, physicalStock: current.physicalStock, submittedAt: current.submittedAt.toISOString() } : null,
    items: items.map(({ name, code, id, salesUnit }) => {
      const comparisonSales = comparisonDates.map((date) => byItemAndDay.get(`${id}/${date}`) ?? null);
      const recorded = comparisonSales.filter((qty): qty is string => qty !== null);
      const comparisonTotal = recorded.length && comparisonDates.every((date) => availableDays.has(date))
        ? Decimal.sum(...recorded).toString() : null;
      return {
        name, code, salesUnit, comparisonSales, comparisonTotal,
        sales: dates.map((date) => byItemAndDay.get(`${id}/${date}`) ?? null),
        previousQuantities: history.map(({ quantities }) => quantities[name] ?? null),
      };
    }),
  };
}
