"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { getAdmOrder } from "@/lib/adm/ordering";

type Order = Awaited<ReturnType<typeof getAdmOrder>>;
type Shop = { id: number; name: string; catalog: { name: string; code: string | null }[] };
const control = "rounded-md border bg-background px-3 py-2 text-sm";
const button = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const fullDate = (iso: string) => iso.split("-").reverse().join(".");

export function AdmOrderForm({ shops, initialDate }: { shops: Shop[]; initialDate: string }) {
  const [shopId, setShopId] = useState(shops[0]?.id ?? 0);
  const [date, setDate] = useState(initialDate);
  const shop = shops.find((item) => item.id === shopId);
  if (!shop) return <p>No active ADM shops are configured.</p>;

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm">
          Shop
          <select className={control} value={shopId} onChange={(event) => setShopId(Number(event.target.value))}>
            {shops.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Delivery date
          <input className={control} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      {date && <ShopOrder key={`${shopId}/${date}`} shop={shop} date={date} />}
    </>
  );
}

function ShopOrder({ shop, date }: { shop: Shop; date: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Order["assortment"] | null>(null);
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
  }, [shop.id, date, revision]);

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
    void save("POST", { deliveryDate: date, quantities });
  }

  return (
    <section className="space-y-3">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {!order && !error && <p className="text-sm">Loading ADM order…</p>}
      {order && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Nightly System Sales {shortDate(order.dates[0])}–{shortDate(order.dates[9])}
              {" · "}— means no imported quantity
            </p>
            <button type="button" className={control} disabled={saving}
              onClick={() => setSettings(settings ? null : { ...order.assortment })}>
              {settings ? "Close shop products" : "Manage shop products"}
            </button>
          </div>
          {settings ? (
            <form className="space-y-3 rounded-lg border p-3" onSubmit={(event) => {
              event.preventDefault();
              const items = Object.fromEntries(Object.entries(settings).map(([name, code]) => [name, code?.trim() || null]));
              void save("PUT", { items });
            }}>
              <fieldset className="space-y-2" disabled={saving}>
                {shop.catalog.map(({ name, code }) => {
                  const enabled = Object.hasOwn(settings, name);
                  return (
                    <div key={name} className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={enabled} onChange={(event) => {
                          const next = { ...settings };
                          if (event.target.checked) next[name] = code;
                          else delete next[name];
                          setSettings(next);
                        }} />
                        {name}
                      </label>
                      {enabled && <input className={control} maxLength={100} placeholder="ERP item code"
                        aria-label={`ERP item code for ${name}`} value={settings[name] ?? ""}
                        onChange={(event) => setSettings({ ...settings, [name]: event.target.value })} />}
                    </div>
                  );
                })}
              </fieldset>
              <button className={button} disabled={saving}>Save shop products</button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={submit}>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2">
                  <thead className="bg-muted">
                    <tr>
                      <th scope="col" className="sticky left-0 bg-muted text-left">Product</th>
                      <th scope="col" className="min-w-24 text-left">Item Code</th>
                      <th scope="col" className="min-w-24">
                        Previous order
                        {order.previousDate && <small className="block font-normal">{fullDate(order.previousDate)}{order.previousSource === "workbook" && " (workbook)"}</small>}
                      </th>
                      <th scope="col" className="min-w-24">{order.current ? "Submitted qty" : "New order qty"}</th>
                      {order.dates.map((day) => <th scope="col" key={day}>{shortDate(day)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.name} className="border-t">
                        <th scope="row" className="sticky left-0 min-w-36 bg-background text-left font-medium">
                          {item.name}
                          <small className="block font-normal text-muted-foreground">
                            {[item.salesUnit ? `Sales in ${item.salesUnit}` : null, !item.matched ? "Sales item unmapped" : null].filter(Boolean).join(" · ")}
                          </small>
                        </th>
                        <td className="whitespace-nowrap font-mono">{item.code ?? "—"}</td>
                        <td className="text-right tabular-nums">{item.previousQty ?? "—"}</td>
                        <td className="text-right tabular-nums">
                          {order.current ? order.current.quantities[item.name] ?? "—" :
                            <input className={`${control} w-24 text-right`} type="number" inputMode="decimal"
                              min={0} max={999999} step="0.001" disabled={saving}
                              aria-label={`Order quantity for ${item.name}`} value={entries[item.name] ?? ""}
                              onChange={(event) => setEntries({ ...entries, [item.name]: event.target.value })} />}
                        </td>
                        {item.sales.map((qty, index) => (
                          <td key={order.dates[index]} className="text-right tabular-nums">{qty === null ? "—" : Number(qty)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!order.items.length && <p className="text-sm">Use Manage shop products to add items.</p>}
              {order.current ? <p className="text-sm">Submitted for delivery on {fullDate(date)}.</p> :
                <button className={button} disabled={saving || !order.items.some(({ name }) => entries[name]?.trim())}>
                  {saving ? "Submitting…" : "Submit order"}
                </button>}
            </form>
          )}
        </>
      )}
    </section>
  );
}
