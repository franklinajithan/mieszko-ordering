"use client";

import { useEffect, useState } from "react";

type StatusRow = {
  store_id: number;
  store_code: string;
  store_name: string;
  source_type: "normal_sales" | "rtc" | "wastage" | "book_stock";
  status: string | null;
  started_at: string | null;
  imported_at: string | null;
  imported_row_count: number | null;
  error_message: string | null;
  last_successful_import_at: string | null;
  last_successful_row_count: number | null;
};
type Response = { success: boolean; configured?: boolean; rows?: StatusRow[]; message?: string; error?: string };
const sources = [
  ["normal_sales", "Normal sales"], ["rtc", "RTC sales"], ["wastage", "Wastage"], ["book_stock", "Book stock"],
] as const;
function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "Never";
}
export function DataOperationsStatus() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [queueingStore, setQueueingStore] = useState<number | null>(null);
  async function requestBookStock(storeId: number) {
    setQueueingStore(storeId);
    setQueueMessage(null);
    try {
      const response = await fetch("/api/data-operations/book-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      const result = await response.json() as { success?: boolean; message?: string; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error ?? "Unable to queue refresh");
      setQueueMessage(result.message ?? "Refresh queued.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to queue refresh");
    } finally {
      setQueueingStore(null);
    }
  }
  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/data-operations/status", { cache: "no-store" });
      const json = await response.json() as Response;
      if (!response.ok || !json.success) throw new Error(json.error ?? "Status unavailable");
      setData(json);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Status unavailable");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);
  const rows = data?.rows ?? [];
  const stores = [...new Map(rows.map(row => [row.store_id, { id: row.store_id, name: row.store_name, code: row.store_code }])).values()];
  return (
    <section className="space-y-3" aria-label="Live data import monitoring">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold">Import monitoring</h3><p className="text-xs text-zinc-500">Latest attempt and last successful import are tracked separately.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50">{loading ? "Checking…" : "Refresh status"}</button>
      </div>
      {queueMessage ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{queueMessage} This does not mean stock has been updated.</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {!loading && data?.configured === false ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{data.message ?? "Office database migration required. Import monitoring is not active."}</p> : null}
      {!loading && data?.configured && stores.length === 0 ? <p className="text-sm text-zinc-500">No active stores found.</p> : null}
      {data?.configured && stores.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-[850px] w-full text-left text-sm">
            <thead className="bg-zinc-50"><tr><th className="p-3">Store</th>{sources.map(([key,label]) => <th key={key} className="p-3">{label}</th>)}</tr></thead>
            <tbody>{stores.map(store => (
              <tr key={store.id} className="border-t align-top">
                <th className="p-3 font-semibold">{store.name}<div className="text-xs font-normal text-zinc-500">{store.code}</div><button type="button" onClick={() => void requestBookStock(store.id)} disabled={queueingStore !== null || loading} className="mt-2 rounded border px-2 py-1 text-xs font-normal disabled:opacity-50">{queueingStore === store.id ? "Queuing…" : "Refresh book stock"}</button></th>
                {sources.map(([key]) => {
                  const item = rows.find(row => row.store_id === store.id && row.source_type === key);
                  const failed = item?.status === "failed";
                  const ageHours = item?.last_successful_import_at
                    ? (Date.now() - new Date(item.last_successful_import_at).getTime()) / 3600000
                    : null;
                  const stale = ageHours !== null && ageHours > (key === "book_stock" ? 24 : 36);
                  const statusLabel = failed ? "Latest attempt failed" : item?.status === "success" ? "Last attempt succeeded" : item?.status ?? "No runs recorded";
                  return <td key={key} className="p-3">
                    <p className={`font-medium ${failed ? "text-red-700" : item?.status === "success" ? "text-emerald-700" : "text-amber-700"}`}>{statusLabel}</p>
                    <p className="mt-1 text-xs text-zinc-600">Last success: {dateLabel(item?.last_successful_import_at ?? null)}</p>
                    <p className="text-xs text-zinc-500">Rows: {item?.last_successful_row_count ?? "Not reported"}</p>
                    {stale ? <p className="mt-1 text-xs font-medium text-amber-700">Last success older than {key === "book_stock" ? "24" : "36"} hours</p> : null}
                    {!item?.last_successful_import_at ? <p className="mt-1 text-xs text-amber-700">No successful import recorded</p> : null}
                    {failed ? <p className="mt-1 max-w-56 break-words text-xs text-red-700">{item?.error_message ?? "Import failed"}</p> : null}
                  </td>;
                })}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
