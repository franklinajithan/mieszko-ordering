import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { and, asc, desc, eq } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/db";
import { admOrders, stores } from "@/db/schema";
import { storeRepository } from "@/repositories/stores";
import { isIsoDateString } from "@/utils/iso-date";

const pageSize = 50;
const historyPath = "/adm-order/history";
const action = "inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50";
const dateLabel = (date: string) => date.split("-").reverse().join(".");

export default async function AdmOrderHistory({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const selectedShop = typeof params.shop === "string" && /^\d+$/.test(params.shop) ? Number(params.shop) : 0;
  const shopId = selectedShop > 0 && selectedShop <= 2147483647 ? selectedShop : 0;
  const deliveryDate = typeof params.deliveryDate === "string" && isIsoDateString(params.deliveryDate) ? params.deliveryDate : "";
  const requestedPage = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const page = Math.min(Math.max(requestedPage, 1), 100000);

  const [allShops, rows] = await Promise.all([
    storeRepository.list(),
    db.select({ storeId: stores.id, shopName: stores.name, deliveryDate: admOrders.deliveryDate, submittedAt: admOrders.submittedAt })
      .from(admOrders)
      .innerJoin(stores, eq(admOrders.storeId, stores.id))
      .where(and(eq(stores.erpType, "msp"), shopId ? eq(stores.id, shopId) : undefined,
        deliveryDate ? eq(admOrders.deliveryDate, deliveryDate) : undefined))
      .orderBy(desc(admOrders.deliveryDate), asc(stores.name), asc(stores.id))
      .limit(pageSize + 1).offset((page - 1) * pageSize),
  ]);

  function pageLink(number: number) {
    const query = new URLSearchParams({ page: String(number) });
    if (shopId) query.set("shop", String(shopId));
    if (deliveryDate) query.set("deliveryDate", deliveryDate);
    return `${historyPath}?${query}`;
  }

  return (
    <AppShell title="ADM Order History">
      <div className="space-y-4">
        <Link href="/adm-order" className={action}><ArrowLeft size={16} aria-hidden /> Back to ADM Order</Link>
        <form action={historyPath} method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4">
          <label className="grid gap-1 text-sm font-medium">
            Shop
            <select name="shop" defaultValue={shopId || ""} className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <option value="">All shops</option>
              {allShops.filter(({ erpType }) => erpType === "msp").map(({ id, name }) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Delivery date
            <input name="deliveryDate" type="date" defaultValue={deliveryDate} className="rounded-lg border border-zinc-200 bg-white px-3 py-2" />
          </label>
          <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Filter orders</button>
          {(!!shopId || !!deliveryDate) && <Link href={historyPath} className={action}>Clear filters</Link>}
        </form>

        {rows.length ? (
          <ul aria-label="Submitted ADM orders" className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
            {rows.slice(0, pageSize).map((row) => {
              const query = new URLSearchParams({ storeId: String(row.storeId), deliveryDate: row.deliveryDate });
              const pdf = `/api/adm-order/pdf?${query}`;
              return (
                <li key={`${row.storeId}/${row.deliveryDate}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-semibold text-zinc-900">{row.shopName} · {dateLabel(row.deliveryDate)}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Submitted {row.submittedAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={`${pdf}&view=1`} target="_blank" rel="noopener" className={action}
                      aria-label={`View PDF for ${row.shopName} on ${dateLabel(row.deliveryDate)}`}>
                      <FileText size={15} aria-hidden /> View PDF
                    </a>
                    <a href={pdf} className={action} aria-label={`Download PDF for ${row.shopName} on ${dateLabel(row.deliveryDate)}`}>
                      <Download size={15} aria-hidden /> Download PDF
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">No submitted ADM orders for these filters.</p>}

        {(page > 1 || rows.length > pageSize) && (
          <nav aria-label="ADM history pages" className="flex gap-2">
            {page > 1 && <Link href={pageLink(page - 1)} className={action}>Previous page</Link>}
            {rows.length > pageSize && <Link href={pageLink(page + 1)} className={action}>Next page</Link>}
          </nav>
        )}
      </div>
    </AppShell>
  );
}
