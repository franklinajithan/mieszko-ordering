import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { admOrders, admShopAssortments, admShopCatalogs, stores } from "@/db/schema";
import { getAdmCatalog } from "@/lib/adm/catalog";
import { getAdmAssortment, getAdmOrder } from "@/lib/adm/ordering";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { storeRepository } from "@/repositories/stores";
import { isIsoDateString } from "@/utils/iso-date";
import { todayIso } from "@/utils/order-sheet-form";

const storeId = z.number().int().positive().max(2147483647);
const day = z.string().refine(isIsoDateString, "Choose a valid delivery date.");
const orderSchema = z.object({
  storeId, deliveryDate: day,
  quantities: z.record(z.string(), z.number().nonnegative().max(999999).multipleOf(0.001)),
});
const assortmentSchema = z.object({
  storeId,
  items: z.record(z.string(), z.string().trim().min(1).max(100).nullable()),
  addedProducts: z.array(z.object({
    name: z.string().trim().min(1).max(500),
    code: z.string().trim().min(1).max(100),
  })).max(100).default([]),
});

async function shopCatalog(id: number) {
  const shop = await storeRepository.getById(id);
  return shop?.isActive && shop.erpType === "msp" ? { ...await getAdmCatalog(id), code: shop.code } : null;
}

export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const query = z.object({ storeId, deliveryDate: day }).safeParse({
    storeId: Number(params.get("storeId")), deliveryDate: params.get("deliveryDate"),
  });
  if (!query.success) return apiError("Choose a shop and a valid delivery date.");
  const { storeId: id, deliveryDate } = query.data;
  const catalog = await shopCatalog(id);
  if (!catalog) return apiError("ADM ordering is unavailable for this shop.", 404);
  return apiOk(await getAdmOrder(id, catalog.code, catalog.items, deliveryDate, catalog.previousDate));
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, orderSchema);
  if (!parsed.ok) return parsed.response;
  const { storeId: id, deliveryDate, quantities } = parsed.data;
  if (deliveryDate < todayIso()) return apiError("Choose today or a future delivery date.");
  const catalog = await shopCatalog(id);
  if (!catalog) return apiError("ADM ordering is unavailable for this shop.", 404);
  const assortment = await getAdmAssortment(id, catalog.items);
  const lines = Object.keys(quantities);
  if (!lines.length) return apiError("Enter at least one order quantity.");
  if (lines.some((name) => !Object.hasOwn(assortment, name))) {
    return apiError("The shop’s product list changed. Reload the order and try again.", 409);
  }

  const [order] = await db.insert(admOrders).values({ storeId: id, deliveryDate, quantities })
    .onConflictDoNothing().returning({ submittedAt: admOrders.submittedAt });
  if (!order) return apiError("This shop already submitted an order for that delivery date.", 409);
  return apiOk(order, 201);
});

export const PUT = route(async (req) => {
  const parsed = await parseJson(req, assortmentSchema);
  if (!parsed.ok) return parsed.response;
  const { storeId: id, items, addedProducts } = parsed.data;
  return db.transaction(async (tx) => {
    const [shop] = await tx.select().from(stores).where(eq(stores.id, id)).for("update");
    if (!shop?.isActive || shop.erpType !== "msp") return apiError("ADM ordering is unavailable for this shop.", 404);
    const catalog = await getAdmCatalog(id, tx);
    const names = new Set(catalog.items.map((item) => item.name));
    const itemCodes = new Set(catalog.items.map((item) => item.code?.toUpperCase()));
    for (const { name, code } of addedProducts) {
      if (names.has(name) || itemCodes.has(code.toUpperCase())) return apiError("That product name or item code is already in this shop’s catalog. Select it from the list.");
      names.add(name);
      itemCodes.add(code.toUpperCase());
    }
    if (Object.keys(items).some((name) => !names.has(name))) return apiError("The list contains an unknown ADM product.");
    if (addedProducts.length) {
      const updated = { ...catalog, items: [...catalog.items, ...addedProducts.map(({ name, code }) => ({
        name, code, barcode: null, salesUnit: null, previousQty: null,
      }))] };
      await tx.insert(admShopCatalogs).values({ storeId: id, ...updated })
        .onConflictDoUpdate({ target: admShopCatalogs.storeId, set: updated });
    }
    await tx.insert(admShopAssortments).values({ storeId: id, items })
      .onConflictDoUpdate({ target: admShopAssortments.storeId, set: { items } });
    return apiOk({ saved: true });
  });
});
