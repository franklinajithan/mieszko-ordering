"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { historicalImportDates, historicalImportBatches, londonToday, movementFeeds } from "@/validators/crm-automation";
import {withReadTimeout} from '@/utils/read-timeout';

type CrmStore = { id: number; code: string; name: string; erp_type: string; is_active: boolean; crm_url: string | null; nightly_enabled: boolean };
type ImportProgress = { total: number; counts: Record<string, number>; recent: { id: number; store_name: string; source_type: keyof typeof labels; day: string; status: string; imported_row_count: number | null; error_message: string | null }[]; checkedAt: string };
const labels = { normal_sales: "Normal Sales", rtc: "RTC Sales", wastage: "Wastage" };

async function requestJson(url: string, options?: RequestInit) {
  const perform = async (signal?: AbortSignal) => {
  const response = await fetch(url, { cache: "no-store", ...options, signal });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error || "The request failed. Try again.");
  return body.data;
  };
  return !options?.method || options.method === 'GET' ? withReadTimeout(perform, {signal: options?.signal ?? undefined}) : perform(options.signal ?? undefined);
}

export function CrmAutomation() {
  const [stores, setStores] = useState<CrmStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [progressVersion, setProgressVersion] = useState(0);
  const [progress, setProgress] = useState<{query: string; data: ImportProgress} | null>(null);
  const [progressError, setProgressError] = useState("");
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
    let queued = 0, skippedCount = 0, accepted = 0;
    try {
      const batches = historicalImportBatches(from, to);
      for (const [index, batch] of batches.entries()) {
        setMessage(`Queueing date batch ${index + 1} of ${batches.length}: ${batch.startDate} to ${batch.endDate}. ${queued} jobs accepted so far.`);
        const result = await requestJson("/api/automation/imports", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeIds: selected, feeds, ...batch, replaceCompleted: replace }) });
        queued += result.queued; skippedCount += result.skipped.length; accepted++;
        setSkipped(items => [...items, ...result.skipped]);
      }
      setMessage(`${queued} daily report jobs queued; ${skippedCount} existing attempts skipped. The Ubuntu worker downloads, validates and imports each file automatically when running. Keep this page open to watch progress; closing it does not cancel accepted jobs.`);
    } catch (e) {
      setMessage(`${queued} jobs accepted in ${accepted} completed date batches; ${skippedCount} attempts skipped. Accepted jobs remain queued. Retry the same range to resume; existing attempts are skipped.`);
      setError(e instanceof Error ? e.message : "Unable to queue imports.");
    } finally { setQueueing(false); }
  }
  async function redownload(row: ImportProgress['recent'][number]) {
    setRetrying(row.id); setError(''); setMessage('');
    try {
      const result = await requestJson('/api/data-operations/retry', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({runId: row.id}),
      });
      setMessage(`${row.store_name}: ${labels[row.source_type]} for ${row.day} ${result.alreadyQueued ? 'is already queued or processing' : 'queued for a fresh download and import'} (job #${result.runId}). The Ubuntu worker will process it using the saved CRM URL. Previous saved data stays until validation succeeds.`);
      setProgressVersion(version => version + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to queue a fresh download.'); }
    finally { setRetrying(null); }
  }
  let estimate = 0, dateError = "", progressQuery = "";
  try {
    estimate = historicalImportDates(from, to).length * selected.length * feeds.length;
    if (to >= londonToday()) throw new Error("Choose completed days only, up to yesterday in London time.");
    if (selected.length && feeds.length) progressQuery = new URLSearchParams({stores: selected.join(','), feeds: feeds.join(','), from, to}).toString();
  } catch (e) { dateError = e instanceof Error ? e.message : "Choose a valid date range."; }
  useEffect(() => {
    if (!progressQuery) return;
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const data = await requestJson(`/api/automation/imports?${progressQuery}`, {signal: controller.signal});
        if (!controller.signal.aborted) { setProgress({query: progressQuery, data}); setProgressError(""); }
      } catch {
        if (!controller.signal.aborted) setProgressError("Import progress could not be refreshed. Check the app connection; accepted jobs remain on the server.");
      } finally { busy = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [progressQuery, queueing, progressVersion]);
  const currentProgress = progress?.query === progressQuery ? progress.data : null;
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
        <h2 className="text-xl font-semibold">Download and import a date range</h2>
        <p className="text-sm">Choose Wastage alone to backfill previous wastage dates. Each file is imported into its matching store and day after validation.</p>
        <fieldset disabled={queueing} className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <label>From date<Input type="date" aria-label="From date" max={yesterday} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>To date<Input type="date" aria-label="To date" max={yesterday} value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
        <fieldset><legend className="font-medium">Stores</legend><div className="flex flex-wrap gap-4">{stores.filter(s => s.is_active && s.erp_type === 'msp').map(s => <label key={s.id} className="flex gap-2"><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} />{s.name}</label>)}</div></fieldset>
        <fieldset><legend className="font-medium">Separate report feeds</legend><div className="flex flex-wrap gap-4">{movementFeeds.map(feed => <label key={feed} className="flex gap-2"><input type="checkbox" checked={feeds.includes(feed)} onChange={e => setFeeds(items => e.target.checked ? [...items, feed] : items.filter(item => item !== feed))} />{labels[feed]}</label>)}</div></fieldset>
        <label className="flex gap-2"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Re-download previously completed or failed dates. Active jobs are always skipped.</label>
        <p className="text-sm">{estimate} possible daily jobs before duplicate checks. Up to 366 days, queued in batches of 31 days. A range is split into individual days, never imported as a weekly total.</p>
        {dateError && <p role="alert" className="text-red-700">{dateError}</p>}
        </fieldset>
        <Button onClick={queue} disabled={queueing || !!dateError || !selected.length || !feeds.length || !from || !to}>{queueing ? "Queueing…" : "Download and import daily reports"}</Button>
        {skipped.length > 0 && <details><summary>{skipped.length} skipped attempts</summary><ul className="list-disc pl-5">{skipped.map((item, i) => <li key={i}>{stores.find(s => s.id === item.storeId)?.name}: {labels[item.feed]}, {item.date}: {item.reason}</li>)}</ul></details>}
      </section>
      <section aria-label="Daily import progress" className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-xl font-semibold">Daily import progress</h2>
        {progressError && <p role="alert">{progressError}</p>}
        {!progressQuery ? <p>Select stores, feeds and valid dates to view progress.</p> : !currentProgress ? <p>Loading import progress…</p> : <>
          <p role="status" aria-live="polite">{currentProgress.counts.success} completed · {currentProgress.counts.failed} failed · {currentProgress.counts.queued} queued · {(currentProgress.counts.downloading ?? 0) + (currentProgress.counts.downloaded ?? 0) + (currentProgress.counts.importing ?? 0)} processing</p>
          <p className="text-sm text-zinc-600">Updated {new Date(currentProgress.checkedAt).toLocaleTimeString('en-GB')}. Completion means saved to PostgreSQL. Queued jobs need the Ubuntu worker running and the selected report feed enabled.</p>
          {currentProgress.counts.failed > 0 && <p className="text-sm">Use Re-download on a failed report to fetch that store, feed and date again. Correct changed CRM URLs or missing product mappings first. A retry cannot resolve an unchanged source error.</p>}
          {currentProgress.counts.queued > 0 && currentProgress.counts.downloading + currentProgress.counts.downloaded + currentProgress.counts.importing === 0 && <p className="text-amber-800">Waiting for the server worker to pick up these reports. If this persists, check the worker service and enabled feeds.</p>}
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Store</th><th className="p-2">Date</th><th className="p-2">Feed</th><th className="p-2">Status</th><th className="p-2">Products saved</th><th className="p-2">Details</th><th className="p-2">Action</th></tr></thead>
          <tbody>{currentProgress.recent.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.store_name}</td><td className="p-2">{row.day}</td><td className="p-2">{labels[row.source_type]}</td><td className="p-2">{row.status}</td><td className="p-2">{row.imported_row_count ?? '—'}</td><td className="p-2">{row.error_message ?? (row.status === 'success' ? 'Saved; open the feed page to view data.' : '')}</td><td className="p-2">{row.status === 'failed' && <Button onClick={() => void redownload(row)} disabled={retrying !== null || queueing} aria-label={`Re-download ${row.store_name} ${labels[row.source_type]} ${row.day}`}>{retrying === row.id ? 'Queueing…' : 'Re-download'}</Button>}</td></tr>)}</tbody></table></div>
          {currentProgress.total > 50 && <p className="text-sm">Showing 50 attempts; active and failed reports appear first. Narrow the date range to inspect older completed dates.</p>}
          <p className="flex gap-4"><Link href="/wastage" className="text-blue-700 underline">View saved Wastage</Link><Link href="/daily-sales" className="text-blue-700 underline">View Normal Sales</Link><Link href="/rtc" className="text-blue-700 underline">View RTC</Link></p>
        </>}
      </section>
    </>}
  </div>;
}
