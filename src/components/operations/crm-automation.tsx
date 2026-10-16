"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dailyImportDates, londonToday, movementFeeds } from "@/validators/crm-automation";

type CrmStore = { id: number; code: string; name: string; erp_type: string; is_active: boolean; crm_url: string | null; nightly_enabled: boolean };
const labels = { normal_sales: "Normal Sales", rtc: "RTC Sales", wastage: "Wastage" };

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || "The request failed. Try again.");
  return body.data;
}

export function CrmAutomation() {
  const [stores, setStores] = useState<CrmStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [feeds, setFeeds] = useState<string[]>([...movementFeeds]);
  const yesterday = new Date(Date.parse(londonToday() + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(yesterday);
  const [to, setTo] = useState(yesterday);
  const [replace, setReplace] = useState(false);
  const [skipped, setSkipped] = useState<{ storeId: number; feed: keyof typeof labels; date: string; reason: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    requestJson("/api/automation/stores", { signal: controller.signal })
      .then(setStores).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  function change(id: number, patch: Partial<CrmStore>) {
    setStores(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }
  async function save(store: CrmStore) {
    setError(""); setMessage(""); setSaving(store.id);
    try {
      await requestJson(`/api/automation/stores/${store.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crmUrl: store.crm_url, nightlyEnabled: store.nightly_enabled }) });
      setMessage(`${store.name}: CRM settings saved. The next job will read the saved URL. A download already in progress keeps its current session.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save CRM settings."); }
    finally { setSaving(null); }
  }
  async function queue() {
    setError(""); setMessage(""); setSkipped([]); setQueueing(true);
    try {
      const result = await requestJson("/api/automation/imports", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeIds: selected, feeds, startDate: from, endDate: to, replaceCompleted: replace }) });
      setSkipped(result.skipped);
      setMessage(`${result.queued} daily report jobs queued; ${result.skipped.length} existing attempts skipped. Jobs wait until the configured server worker is running.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to queue imports."); }
    finally { setQueueing(false); }
  }
  let estimate = 0;
  try { estimate = dailyImportDates(from, to).length * selected.length * feeds.length; } catch { /* The API returns the precise date error. */ }
  return <div className="space-y-6">
    <p>Download yesterday automatically, or choose completed dates to fill gaps. Each store, date and feed has a separate job. Book Stock remains manual.</p>
    <p><Link className="text-blue-700 underline" href="/operations">Open import progress and retry controls</Link></p>
    {loading && <p role="status">Loading store CRM settings…</p>}
    {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded border border-green-300 bg-green-50 p-3">{message}</p>}
    {!loading && stores.length > 0 && <>
      <section className="space-y-3" aria-label="Store CRM settings">
        <h2 className="text-xl font-semibold">Store CRM addresses</h2>
        <p className="text-sm text-zinc-600">Save a new URL here when a store address changes. Login codes stay in the server environment. The nightly checkbox controls eligibility; a verified server scheduler must also be running.</p>
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm">
          <thead className="bg-zinc-50"><tr><th className="p-3">Store</th><th className="p-3">CRM URL</th><th className="p-3">Nightly queue</th><th className="p-3">Save</th></tr></thead>
          <tbody>{stores.map(store => <tr key={store.id} className="border-t">
            <td className="p-3">{store.name} ({store.code}){!store.is_active && <span> — inactive</span>}</td>
            <td className="min-w-80 p-3"><Input aria-label={`${store.name} CRM URL`} type="url" placeholder="http://store-address:port/" value={store.crm_url ?? ""} onChange={e => change(store.id, { crm_url: e.target.value })} /></td>
            <td className="p-3"><label className="flex gap-2"><input type="checkbox" aria-label={`${store.name} nightly imports`} checked={store.nightly_enabled} disabled={(!store.is_active || store.erp_type !== 'msp') && !store.nightly_enabled} onChange={e => change(store.id, { nightly_enabled: e.target.checked })} />Include</label></td>
            <td className="p-3"><Button onClick={() => save(store)} disabled={saving !== null || !store.crm_url?.trim()} aria-label={`Save ${store.name} CRM settings`}>{saving === store.id ? "Saving…" : "Save"}</Button></td>
          </tr>)}</tbody></table></div>
      </section>
      <section aria-label="Queue daily reports" className="space-y-4 rounded-xl border bg-white p-4">
        <h2 className="text-xl font-semibold">Download a date range</h2>
        <div className="flex flex-wrap gap-4">
          <label>From date<Input type="date" aria-label="From date" max={yesterday} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>To date<Input type="date" aria-label="To date" max={yesterday} value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
        <fieldset><legend className="font-medium">Stores</legend><div className="flex flex-wrap gap-4">{stores.filter(s => s.is_active && s.erp_type === 'msp').map(s => <label key={s.id} className="flex gap-2"><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />{s.name}</label>)}</div></fieldset>
        <fieldset><legend className="font-medium">Separate report feeds</legend><div className="flex flex-wrap gap-4">{movementFeeds.map(feed => <label key={feed} className="flex gap-2"><input type="checkbox" checked={feeds.includes(feed)} onChange={e => setFeeds(items => e.target.checked ? [...items, feed] : items.filter(item => item !== feed))} />{labels[feed]}</label>)}</div></fieldset>
        <label className="flex gap-2"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Re-download previously completed or failed dates. Active jobs are always skipped.</label>
        <p className="text-sm">{estimate} possible daily jobs before duplicate checks. Maximum 31 days per request. A range is split into individual days, never imported as a weekly total.</p>
        <Button onClick={queue} disabled={queueing || !selected.length || !feeds.length || !from || !to}>{queueing ? "Queueing…" : "Queue daily downloads"}</Button>
        {skipped.length > 0 && <details><summary>{skipped.length} skipped attempts</summary><ul className="list-disc pl-5">{skipped.map((item, i) => <li key={i}>{stores.find(s => s.id === item.storeId)?.name}: {labels[item.feed]}, {item.date}: {item.reason}</li>)}</ul></details>}
      </section>
    </>}
  </div>;
}
