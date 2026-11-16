import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admShopCatalogs, stores as storeTable } from "@/db/schema";
import { admShopKey } from "@/lib/adm/parse-workbook";
import { apiError, apiOk, parseJson, route } from "@/lib/api/http";
import { storeRepository } from "@/repositories/stores";
import { todayIso } from "@/utils/order-sheet-form";

const workbookSchema = z.object({
  catalogs: z.record(z.string(), z.object({
    previousDate: z.iso.date().nullable(),
    items: z.array(z.object({
      name: z.string().trim().min(1).max(500),
      code: z.string().trim().min(1).max(100).nullable(),
      barcode: z.string().regex(/^\d{1,100}$/).nullable(),
      salesUnit: z.enum(["pcs", "kg"]).nullable(),
      previousQty: z.number().nonnegative().nullable(),
    })).min(1).max(500),
  })),
});

export const POST = route(async (req) => {
  const parsed = await parseJson(req, workbookSchema);
  if (!parsed.ok) return parsed.response;
  const catalogs = Object.entries(parsed.data.catalogs);
  if (catalogs.length < 1 || catalogs.length > 9) return apiError("Choose a workbook with valid shop tabs.");
  const today = todayIso();
  for (const [key, catalog] of catalogs) {
    if (admShopKey(key) !== key || (catalog.previousDate && catalog.previousDate >= today)
      || new Set(catalog.items.map(({ name }) => name)).size !== catalog.items.length) {
      return apiError("The workbook contains an invalid shop, date or duplicate product.");
    }
  }
  const stores = await storeRepository.list();
  const matched: { store: (typeof stores)[number]; catalog: Omit<typeof admShopCatalogs.$inferInsert, "storeId"> }[] = [];
  const skipped: string[] = [];
  for (const [key, catalog] of catalogs) {
    const matches = stores.filter((store) => store.isActive && store.erpType === "msp" && (admShopKey(store.code) ?? admShopKey(store.name)) === key);
    if (matches.length > 1) return apiError(`Multiple active shops match ${key}. Check the store settings.`, 409);
    if (matches.length === 0) skipped.push(key);
    else matched.push({ store: matches[0], catalog });
  }
  if (!matched.length) return apiError("No workbook tabs match an active Mieszko shop.");
  // Import the workbook as a single transaction and retain shop-specific selections and submissions.
  await db.transaction(async (tx) => {
    for (const { store, catalog } of matched.sort((a, b) => a.store.id - b.store.id)) {
      await tx.select({ id: storeTable.id }).from(storeTable).where(eq(storeTable.id, store.id)).for("update");
      const [saved] = await tx.select().from(admShopCatalogs).where(eq(admShopCatalogs.storeId, store.id));
      const byName = new Map(saved?.items.map((item) => [item.name, item]));
      const items = catalog.items.map((item) => {
        const existing = byName.get(item.name);
        byName.delete(item.name);
        return { ...item, code: item.code ?? existing?.code ?? null };
      });
      const previousDate = catalog.previousDate ?? saved?.previousDate ?? null;
      if (!catalog.previousDate && saved?.previousDate) {
        const previous = new Map(saved.items.map(({ name, previousQty }) => [name, previousQty]));
        for (const item of items) item.previousQty = previous.get(item.name) ?? null;
      }
      const savedCatalog = { items: [...items, ...[...byName.values()].map((item) => ({
        ...item, previousQty: catalog.previousDate ? null : item.previousQty,
      }))], previousDate };
      await tx.insert(admShopCatalogs).values({ storeId: store.id, ...savedCatalog })
        .onConflictDoUpdate({ target: admShopCatalogs.storeId, set: savedCatalog });
    }
  });
  return apiOk({ imported: matched.map(({ store }) => store.name), skipped });
});
