import { db } from "@/db";
import { admShopCatalogs } from "@/db/schema";
import { admShopKey, parseAdmWorkbook } from "@/lib/adm/parse-workbook";
import { apiError, apiOk, route } from "@/lib/api/http";
import { storeRepository } from "@/repositories/stores";
import { isIsoDateString } from "@/utils/iso-date";
import { todayIso } from "@/utils/order-sheet-form";

export const POST = route(async (req) => {
  const form = await req.formData();
  const file = form.get("workbook");
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.size > 8 * 1024 * 1024) {
    return apiError("Choose an ADM .xlsx workbook smaller than 8 MB.");
  }
  const filenameDate = /(\d{2})-(\d{2})-(\d{4})\.xlsx$/i.exec(file.name);
  const workbookDate = filenameDate ? `${filenameDate[3]}-${filenameDate[2]}-${filenameDate[1]}` : null;
  const today = todayIso();
  const asOf = isIsoDateString(workbookDate) && workbookDate <= today ? workbookDate : today;
  const catalogs = parseAdmWorkbook(await file.arrayBuffer(), asOf);
  const stores = await storeRepository.list();
  const matched: { store: (typeof stores)[number]; catalog: Omit<typeof admShopCatalogs.$inferInsert, "storeId"> }[] = [];
  const skipped: string[] = [];
  for (const [key, catalog] of catalogs) {
    const matches = stores.filter((store) => store.isActive && (admShopKey(store.code) ?? admShopKey(store.name)) === key);
    if (matches.length > 1) return apiError(`Multiple active shops match ${key}. Check the store settings.`, 409);
    if (matches.length === 0) skipped.push(key);
    else matched.push({ store: matches[0], catalog });
  }
  if (!matched.length) return apiError("No workbook tabs match an active Mieszko shop.");
  // Import the workbook as a single transaction and retain shop-specific selections and submissions.
  await db.transaction(async (tx) => {
    for (const { store, catalog } of matched.sort((a, b) => a.store.id - b.store.id)) {
      await tx.insert(admShopCatalogs).values({ storeId: store.id, ...catalog })
        .onConflictDoUpdate({ target: admShopCatalogs.storeId, set: catalog });
    }
  });
  return apiOk({ imported: matched.map(({ store }) => store.name), skipped });
});
