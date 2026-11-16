"use client";

import { CalendarDays, Search, Settings2, Store } from "lucide-react";
import { useEffect, useState, type FormEvent, type KeyboardEvent, type CSSProperties } from "react";
import type { getAdmOrder } from "@/lib/adm/ordering";

type Order = Awaited<ReturnType<typeof getAdmOrder>>;
type Shop = { id: number; name: string };
const control = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100";
const button = "rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";
const gridColumns = "grid grid-cols-[var(--adm-grid-columns)]";
const gridCell = "flex min-w-0 items-center border-r border-zinc-100 px-2.5 py-2";
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const comparisonDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00Z`);
  const month = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date);
  return `${date.getUTCDate()}-${month}`;
};
const fullDate = (iso: string) => iso.split("-").reverse().join(".");

function moveQuantityFocus(event: KeyboardEvent<HTMLDivElement>) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.hasAttribute("data-order-qty")) return;
  if (event.key !== "Enter" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const inputs = [...event.currentTarget.querySelectorAll<HTMLInputElement>("[data-order-qty]:enabled")]
    .filter((cell) => cell.dataset.orderQty === input.dataset.orderQty);
  const offset = event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey) ? -1 : 1;
  inputs[inputs.indexOf(input) + offset]?.focus();
}

export function AdmOrderForm({ shops, initialDate, catalogRevision = 0 }: { shops: Shop[]; initialDate: string; catalogRevision?: number }) {
  const [shopId, setShopId] = useState(shops[0]?.id ?? 0);
  const [date, setDate] = useState(initialDate);
  const shop = shops.find((item) => item.id === shopId);
  if (!shop) return <p>No active Nebula shops are configured.</p>;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
        <label className="grid gap-1 text-sm">
          <span className="flex items-center gap-2 font-medium text-zinc-700"><Store size={15} aria-hidden /> Shop</span>
          <select className={control} value={shopId} onChange={(event) => setShopId(Number(event.target.value))}>
            {shops.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="flex items-center gap-2 font-medium text-zinc-700"><CalendarDays size={15} aria-hidden /> Delivery date</span>
          <input className={control} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      {date && <ShopOrder key={`${shopId}/${date}`} shop={shop} date={date} catalogRevision={catalogRevision} />}
    </>
  );
}

function ShopOrder({ shop, date, catalogRevision }: { shop: Shop; date: string; catalogRevision: number }) {
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Order["assortment"] | null>(null);
  const [addedProducts, setAddedProducts] = useState<{ name: string; code: string }[]>([]);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [revision, refresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ storeId: String(shop.id), deliveryDate: date });
    fetch(`/api/adm-order?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.success) throw new Error(result.error);
        setOrder(result.data);
      })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [shop.id, date, revision, catalogRevision]);

  async function save(method: "POST" | "PUT", body: object) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/adm-order", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: shop.id, ...body }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      setOrder(null);
      refresh((value) => value + 1);
      setSettings(null);
      setNotice(method === "POST" ? "Order submitted." : "Shop products saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || order.current || saving) return;
    const quantities = Object.fromEntries(order.items.flatMap(({ name }) =>
      entries[name]?.trim() ? [[name, Number(entries[name])]] : [],
    ));
    const physicalStock = Object.fromEntries(order.items.flatMap(({ name }) =>
      stock[name]?.trim() ? [[name, Number(stock[name])]] : [],
    ));
    void save("POST", { deliveryDate: date, quantities, physicalStock });
  }

  const needle = search.trim().toLocaleLowerCase();
  const visibleItems = order?.items.filter(({ name, code }) =>
    name.toLocaleLowerCase().includes(needle) || code?.toLocaleLowerCase().includes(needle),
  );
  const comparisonColumns = order?.comparisonDates.length ? order.comparisonDates.length + 1 : 0;
  const dateStart = order?.comparisonDates[0];
  const dateEnd = order?.comparisonDates.at(-1);
  const comparisonHeading = dateStart && dateEnd ? `${comparisonDate(dateStart)} - ${comparisonDate(dateEnd)} Sales` : "";
  const gridStyle = {
    "--adm-grid-columns": `minmax(14rem,1fr) 7rem 7rem 6rem 7rem 7rem ${comparisonColumns ? `repeat(${comparisonColumns},3.75rem) ` : ""} repeat(10,3.5rem)`,
    minWidth: `${83 + comparisonColumns * 3.75}rem`,
  } as CSSProperties;
  const enteredCount = order?.items.filter(({ name }) => entries[name]?.trim()).length ?? 0;

  return (
    <section className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!order && !error && <p className="text-sm">Loading ADM order…</p>}
      {order && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{shop.name} order</h2>
              <p className="mt-1 text-sm text-zinc-600">
                {order.items.length} products · Daily Sales {shortDate(order.dates[0])}–{shortDate(order.dates[9])}
                {" · "}{order.dates.length - order.missingSalesDates.length}/{order.dates.length} days available
              </p>
              {comparisonColumns > 0 && (
                <p className="mt-2 text-sm font-medium text-teal-900">
                  {comparisonHeading}
                </p>
              )}
              <p className="mt-1 text-sm text-zinc-600">
                Submitted for {fullDate(date)}{order.submittedShops.length ? ` · ${order.submittedShops.join(", ")}` : " · No shops yet"}
              </p>
            </div>
            <button type="button" className={`${control} inline-flex items-center gap-2 font-medium hover:bg-zinc-50`} disabled={saving}
              onClick={() => {
                setAddedProducts([]);
                setNewName("");
                setNewCode("");
                setError("");
                setSettings(settings ? null : { ...order.assortment });
              }}>
              <Settings2 size={16} aria-hidden />
              {settings ? "Close shop products" : "Manage shop products"}
            </button>
          </div>
          {settings ? (
            <form className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5" onSubmit={(event) => {
              event.preventDefault();
              const items = Object.fromEntries(Object.entries(settings).map(([name, code]) => [name, code?.trim() || null]));
              void save("PUT", { items, addedProducts: addedProducts.filter(({ name }) => Object.hasOwn(items, name)) });
            }}>
              <fieldset className="space-y-2" disabled={saving}>
                <div className="flex flex-wrap items-end gap-2 border-b pb-4">
                  <label className="grid gap-1 text-sm">
                    Product name
                    <input className={control} maxLength={500} value={newName}
                      onChange={(event) => setNewName(event.target.value)} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Item Code
                    <input className={control} maxLength={100} value={newCode}
                      onChange={(event) => setNewCode(event.target.value)} />
                  </label>
                  <button type="button" className={control} disabled={!newName.trim() || !newCode.trim()} onClick={() => {
                    const name = newName.trim();
                    const code = newCode.trim();
                    if ([...order.catalog, ...addedProducts].some((item) => item.name === name || item.code?.toUpperCase() === code.toUpperCase())) {
                      setError("That product already exists in this shop’s list. Use Add beside the existing product.");
                      return;
                    }
                    setError("");
                    setAddedProducts([...addedProducts, { name, code }]);
                    setSettings({ ...settings, [name]: code });
                    setNewName("");
                    setNewCode("");
                  }}>Add product</button>
                </div>
                {[...order.catalog, ...addedProducts].map(({ name, code }) => {
                  const enabled = Object.hasOwn(settings, name);
                  return (
                    <div key={name} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
                      <span className="min-w-40 flex-1 text-sm">{name}</span>
                      {enabled && <input className={control} maxLength={100} placeholder="ERP item code"
                        aria-label={`ERP item code for ${name}`} value={settings[name] ?? ""}
                        onChange={(event) => setSettings({ ...settings, [name]: event.target.value })} />}
                      <button type="button" className={control} aria-label={`${enabled ? "Remove" : "Add"} ${name}`}
                        onClick={() => {
                          const next = { ...settings };
                          if (enabled) delete next[name];
                          else next[name] = code;
                          setSettings(next);
                        }}>{enabled ? "Remove" : "Add"}</button>
                    </div>
                  );
                })}
              </fieldset>
              <button className={button} disabled={saving}>Save shop products</button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={submit}>
              <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <label className="flex items-center gap-2 text-zinc-500">
                    <Search size={16} aria-hidden />
                    <input type="search" aria-label="Find a product" placeholder="Find by product or item code"
                      className={`${control} w-64 max-w-full`} value={search} onChange={(event) => setSearch(event.target.value)} />
                  </label>
                  <span className="text-xs text-zinc-500">{order.current ? "— No imported quantity" : "Use Enter or ↑ ↓ to move between quantities"}</span>
                </div>
                <div className="max-h-[65vh] overflow-auto border-t border-zinc-200">
                  <div role="grid" aria-label={`${shop.name} ADM order quantities and daily sales`}
                    className="text-sm" style={gridStyle} onKeyDown={moveQuantityFocus}>
                    <div role="rowgroup" className="sticky top-0 z-20 bg-zinc-100 text-xs font-semibold text-zinc-700">
                      <div role="row" className={`${gridColumns} border-b border-zinc-200`}>
                        <div role="columnheader" aria-colspan={2} className={`${gridCell} col-span-2`}>Shop products</div>
                        <div role="columnheader" aria-colspan={2} className={`${gridCell} col-span-2 justify-center`}>Previous orders</div>
                        <div role="columnheader" aria-colspan={2} className={`${gridCell} col-span-2 justify-center bg-emerald-100 text-emerald-900`}>Order entry</div>
                        {comparisonColumns > 0 && (
                          <div role="columnheader" aria-colspan={comparisonColumns} style={{ gridColumn: `span ${comparisonColumns}` }}
                            className={`${gridCell} bg-teal-100 text-teal-950`}>{comparisonHeading}</div>
                        )}
                        <div role="columnheader" aria-colspan={10} className={`${gridCell} col-span-10`}>Daily Sales</div>
                      </div>
                      <div role="row" className={gridColumns}>
                        <div role="columnheader" className={`${gridCell} sticky left-0 z-10 bg-zinc-100`}>Product</div>
                        <div role="columnheader" className={gridCell}>Item Code</div>
                        {[1, 0].map((index) => (
                          <div role="columnheader" className={`${gridCell} flex-col justify-center text-center`} key={index}>
                            {index === 0 ? "Last order" : "Order before last"}
                            {order.previousDates[index] && <small className="font-normal">{fullDate(order.previousDates[index])}</small>}
                          </div>
                        ))}
                        <div role="columnheader" className={`${gridCell} justify-center bg-zinc-100 text-zinc-800`}>Physical Stock</div>
                        <div role="columnheader" className={`${gridCell} justify-center bg-emerald-50 text-emerald-900`}>
                          {order.current ? "Submitted qty" : "New order qty"}
                        </div>
                        {order.comparisonDates.map((day) => (
                          <div role="columnheader" key={day}
                            title={order.missingComparisonDates.includes(day) ? "No Daily Sales import" : undefined}
                            className={`${gridCell} justify-end bg-teal-50 ${order.missingComparisonDates.includes(day) ? "text-zinc-400" : "text-teal-950"}`}>
                            {shortDate(day)}
                          </div>
                        ))}
                        {comparisonColumns > 0 && <div role="columnheader" className={`${gridCell} justify-end bg-teal-100 text-teal-950`}>Total</div>}
                        {order.dates.map((day) => {
                          const missing = order.missingSalesDates.includes(day);
                          return (
                            <div role="columnheader" key={day} title={missing ? "No Daily Sales import" : undefined}
                              className={`${gridCell} justify-end ${order.comparisonDates.includes(day) ? "bg-teal-100 text-teal-950" : ""} ${missing ? "text-zinc-400" : ""}`}>
                              {shortDate(day)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div role="rowgroup">
                      {visibleItems?.map((item) => (
                        <div role="row" key={item.name}
                          className={`${gridColumns} group border-t border-zinc-100 even:bg-zinc-50 hover:bg-emerald-50/60`}>
                          <div role="rowheader" className={`${gridCell} sticky left-0 z-10 block bg-white font-medium text-zinc-900 group-even:bg-zinc-50 group-hover:bg-emerald-50`}>
                            {item.name}
                          </div>
                          <div role="gridcell" className={`${gridCell} break-all font-mono text-xs text-zinc-600`}>{item.code ?? "—"}</div>
                          {[1, 0].map((index) => (
                            <div role="gridcell" key={index} className={`${gridCell} justify-end tabular-nums`}>
                              {item.previousQuantities[index] ?? "—"}
                            </div>
                          ))}
                          <div role="gridcell" className={`${gridCell} justify-end bg-zinc-50 text-right tabular-nums`}>
                            {order.current ? order.current.physicalStock[item.name] ?? "—" :
                              <input className={`${control} w-full text-right`} type="number" inputMode="decimal"
                                min={0} max={999999} step="0.001" disabled={saving} data-order-qty="stock"
                                aria-label={`Physical stock for ${item.name}`} value={stock[item.name] ?? ""}
                                onChange={(event) => setStock({ ...stock, [item.name]: event.target.value })} />}
                          </div>
                          <div role="gridcell" className={`${gridCell} justify-end bg-emerald-50/70 text-right tabular-nums`}>
                            {order.current ? order.current.quantities[item.name] ?? "—" :
                              <input className={`${control} w-full text-right`} type="number" inputMode="decimal"
                                min={0} max={999999} step="0.001" disabled={saving} data-order-qty="order"
                                aria-label={`Order quantity for ${item.name}`} value={entries[item.name] ?? ""}
                                onChange={(event) => setEntries({ ...entries, [item.name]: event.target.value })} />}
                          </div>
                          {item.comparisonSales.map((qty, index) => (
                            <div role="gridcell" key={order.comparisonDates[index]}
                              className={`${gridCell} justify-end bg-teal-50 tabular-nums ${qty === null ? "text-zinc-400" : ""}`}>
                              {qty === null ? "—" : Number(qty)}
                            </div>
                          ))}
                          {comparisonColumns > 0 && (
                            <div role="gridcell" className={`${gridCell} justify-end bg-teal-100 font-semibold text-teal-950 tabular-nums`}>
                              {item.comparisonTotal === null ? "—" : Number(item.comparisonTotal)}
                            </div>
                          )}
                          {item.sales.map((qty, index) => (
                            <div role="gridcell" key={order.dates[index]}
                              className={`${gridCell} justify-end tabular-nums ${order.comparisonDates.includes(order.dates[index]) ? "bg-teal-50" : ""} ${qty === null ? "text-zinc-400" : "text-zinc-900"}`}>
                              {qty === null ? "—" : Number(qty)}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  {order.items.length > 0 && !visibleItems?.length && <p className="p-5 text-sm text-zinc-600">No products match your search.</p>}
                </div>
              </div>
              {!order.items.length && (
                <p className="text-sm text-zinc-600">
                  {order.catalog.length
                    ? "Use Manage shop products to select the products this shop carries."
                    : "Import the starting shop list from Excel or add a product under Manage shop products."}
                </p>
              )}
              {order.missingComparisonDates.length > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  Comparison total unavailable until Daily Sales are imported for {order.missingComparisonDates.map(shortDate).join(", ")}.
                </p>
              )}
              {order.missingSalesDates.length > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  Daily Sales missing for {order.missingSalesDates.map(shortDate).join(", ")}.
                </p>
              )}
              {order.current ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="rounded bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                    {shop.name} submitted this order.
                  </p>
                  <a className={control} href={`/api/adm-order/pdf?storeId=${shop.id}&deliveryDate=${date}`}>Download PDF</a>
                </div>
              ) :
                <div className="sticky bottom-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
                  <span className="text-sm text-zinc-600">{enteredCount} {enteredCount === 1 ? "quantity" : "quantities"} entered</span>
                  <button className={button} disabled={saving || !enteredCount}>
                    {saving ? "Submitting…" : "Submit order"}
                  </button>
                </div>}
            </form>
          )}
        </>
      )}
    </section>
  );
}
