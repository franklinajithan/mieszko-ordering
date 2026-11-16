import "server-only";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { admOrders, admShopAssortments, productBarcodes, storeProducts } from "@/db/schema";
import { dailySalesRepository } from "@/repositories/daily-sales";
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
  const assortment = await getAdmAssortment(storeId, catalog);
  const codes = Object.values(assortment).filter((code): code is string => Boolean(code));
  const barcodes = catalog.flatMap((item) => item.barcode ? [item.barcode] : []);

  const [currentRows, previousRows, matchedCodes, matchedBarcodes] = await Promise.all([
    db.select().from(admOrders).where(and(eq(admOrders.storeId, storeId), eq(admOrders.deliveryDate, deliveryDate))),
    db.select().from(admOrders).where(and(eq(admOrders.storeId, storeId), lt(admOrders.deliveryDate, deliveryDate)))
      .orderBy(desc(admOrders.deliveryDate)).limit(1),
    codes.length ? db.select({ code: storeProducts.storeProductCode, id: storeProducts.id }).from(storeProducts)
      .where(and(eq(storeProducts.storeId, storeId), inArray(storeProducts.storeProductCode, codes))) : [],
    barcodes.length ? db.select({ barcode: productBarcodes.barcode, id: storeProducts.id }).from(productBarcodes)
      .innerJoin(storeProducts, eq(storeProducts.id, productBarcodes.storeProductId))
      .where(and(eq(storeProducts.storeId, storeId), eq(productBarcodes.storeId, storeId), inArray(productBarcodes.barcode, barcodes))) : [],
  ]);

  const byCode = new Map(matchedCodes.map((row) => [row.code, row.id]));
  const byBarcode = new Map<string, Set<number>>();
  for (const row of matchedBarcodes) {
    if (!byBarcode.has(row.barcode)) byBarcode.set(row.barcode, new Set());
    byBarcode.get(row.barcode)!.add(row.id);
  }
  const current = currentRows[0];
  const knownNames = new Set(catalog.map(({ name }) => name));
  const removedItems = Object.keys(current?.quantities ?? {}).filter((name) => !knownNames.has(name))
    .map((name) => ({ name, code: null, barcode: null, salesUnit: null, previousQty: null }));
  const items = [...catalog, ...removedItems].filter((item) => Object.hasOwn(assortment, item.name)
    || (current && Object.hasOwn(current.quantities, item.name))).map((item) => {
    const code = Object.hasOwn(assortment, item.name) ? assortment[item.name] : item.code;
    const ids = item.barcode && code === item.code ? byBarcode.get(item.barcode) : undefined;
    const id = (code ? byCode.get(code) : undefined) ?? (ids?.size === 1 ? [...ids][0] : undefined);
    return { ...item, code, id };
  });
  const sales = await dailySalesRepository.getSalesByProductsInRange(
    items.flatMap((item) => item.id === undefined ? [] : [item.id]), dates[0], dates[9],
  );
  const byDay = new Map(sales.map((row) => [`${row.storeProductId}/${row.salesDate}`, row.soldQty]));
  const previous = previousRows[0];
  const useWorkbook = workbookOrderDate && deliveryDate > workbookOrderDate && (!previous || previous.deliveryDate < workbookOrderDate);
  return {
    dates, assortment,
    previousDate: useWorkbook ? workbookOrderDate : previous?.deliveryDate ?? null,
    previousSource: useWorkbook ? "workbook" : previous ? "app" : null,
    current: current ? { quantities: current.quantities, submittedAt: current.submittedAt.toISOString() } : null,
    items: items.map(({ name, code, salesUnit, previousQty, id }) => ({
      name, code, salesUnit, matched: id !== undefined,
      sales: dates.map((date) => byDay.get(`${id}/${date}`) ?? null),
      previousQty: useWorkbook ? previousQty : previous?.quantities[name] ?? null,
    })),
  };
}
