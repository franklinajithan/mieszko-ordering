import { db } from "@/db";
import { admShopCatalogs } from "@/db/schema";
import { AdmWorkbookImport } from "./adm-workbook-import";
import { storeRepository } from "@/repositories/stores";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import { AdmOrderForm } from "./adm-order-form";

export const dynamic = "force-dynamic";

export default async function AdmOrderPage() {
  const [stores, catalogs] = await Promise.all([storeRepository.list(), db.select().from(admShopCatalogs)]);
  const byShop = new Map(catalogs.map((row) => [row.storeId, row.items]));
  const shops = stores.flatMap(({ id, name, isActive }) => {
    const items = byShop.get(id);
    return isActive && items?.length ? [{ id, name, catalog: items.map(({ name, code }) => ({ name, code })) }] : [];
  });
  const today = todayIso();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const deliveryDate = addDaysIso(today, Math.min((7 - weekday) % 7, (10 - weekday) % 7));

  return (
    <main className="space-y-5 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">ADM Order</h1>
      <AdmWorkbookImport />
      <AdmOrderForm key={JSON.stringify(shops)} shops={shops} initialDate={deliveryDate} />
    </main>
  );
}
