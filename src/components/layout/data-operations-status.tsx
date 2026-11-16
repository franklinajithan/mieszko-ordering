"use client";

import { useEffect, useState, useRef } from "react";
import { ReportCoverage } from "@/components/operations/report-coverage";
import { londonToday } from "@/validators/crm-automation";
import { importFreshness } from "@/utils/import-freshness";
import {withReadTimeout} from '@/utils/read-timeout';

type StatusRow = {
  erp_type?: string;
  crm_configured?: boolean;
  review_message?: string | null;
  unmatched_identifier_count?: string | number | null;
  downloaded_row_count?:number|null;
  source_start_date?:string|null;
  source_end_date?:string|null;
  latest_run_id: number | string | null;
  zero_activity?:boolean;
  latest_data_date: string | null;
  latest_data_updated_at: string | null;
  duplicate_of?: string | null;
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
function yesterdayInLondon() {
  return new Date(Date.parse(londonToday() + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
}
function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/London" }) : "Never";
}
export function DataOperationsStatus() {
  const reading = useRef(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [coverageFrom, setCoverageFrom] = useState(yesterdayInLondon);
  const [coverageTo, setCoverageTo] = useState(yesterdayInLondon);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [recoveryConfirmed,setRecoveryConfirmed]=useState<string|null>(null);
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
  async function retryImport(runId: number | string,storeId:number) {
    setQueueingStore(storeId);
    setQueueMessage(null);
    setError(null);
    try {
      const response=await fetch('/api/data-operations/retry',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:Number(runId)}),
      });
      const result=await response.json() as {success?:boolean;data?:{message:string};error?:string};
      if (!response.ok || !result.success) throw new Error(result.error ?? 'Unable to queue retry');
      setQueueMessage(result.data?.message ?? 'Import retry queued.');
      await refresh();
    }catch(cause){setError(cause instanceof Error ? cause.message : 'Unable to queue retry');}
    finally{setQueueingStore(null);}
  }
  async function recoverImport(runId:number|string,storeId:number){
    setQueueingStore(storeId);setQueueMessage(null);setError(null);
    try{
      const response=await fetch('/api/data-operations/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:Number(runId),workerStopped:true})});
      const result=await response.json() as {success?:boolean;error?:string};
      if(!response.ok||!result.success)throw new Error(result.error??'Unable to recover attempt');
      setQueueMessage('Interrupted attempt marked failed. Retained data is unchanged. Retry after the office worker is ready.');await refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:'Unable to recover attempt');}finally{setQueueingStore(null);}
  }
  async function refresh() {
    if (reading.current) return;
    reading.current = true;
    setLoading(true);
    setError(null);
    try {
      await withReadTimeout(async signal => {
      const response = await fetch("/api/data-operations/status", { cache: "no-store", signal });
      const json = await response.json() as Response;
      if (!response.ok || !json.success) throw new Error(json.error ?? "Status unavailable");
      setData(json);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Status unavailable");
    } finally {
      reading.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, []);
  const rows = data?.rows ?? [];
  const stores = [...new Map(rows.map(row => [row.store_id, { id: row.store_id, name: row.store_name, code: row.store_code, configured: row.crm_configured, erp: row.erp_type }])).values()];
  return (
    <section className="space-y-3" aria-label="Live data import monitoring">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold">Import monitoring</h3><p className="text-xs text-zinc-500">Report dates show freshness. Matched sales are saved; unmatched products remain available for review.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50">{loading ? "Checking…" : "Refresh status"}</button>
      </div>
      {queueMessage ? <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{queueMessage} Queueing a job does not mean its data has been updated.</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {!loading && data?.configured === false ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{data.message ?? "Office database migration required. Import monitoring is not active."}</p> : null}
      {!loading && data?.configured && stores.length === 0 ? <p className="text-sm text-zinc-500">No active stores found.</p> : null}
      {data?.configured && stores.length > 0 ? (
        <div className="max-h-[650px] overflow-auto rounded-xl border bg-white">
          <table className="min-w-[850px] w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50"><tr><th scope="col" className="sticky left-0 z-20 bg-zinc-50 p-3">Store</th>{sources.map(([key,label]) => <th key={key} scope="col" className="p-3">{label}</th>)}</tr></thead>
            <tbody>{stores.map(store => (
              <tr key={store.id} className="border-t align-top">
                <th scope="row" className="sticky left-0 z-[1] w-40 bg-white p-3 font-semibold">{store.name}<div className="text-xs font-normal text-zinc-500">{store.code}</div><button type="button" onClick={() => void requestBookStock(store.id)} disabled={queueingStore !== null || loading || store.configured === false || store.erp !== "msp"} className="mt-2 rounded border px-2 py-1 text-xs font-normal disabled:opacity-50">{queueingStore === store.id ? "Queuing…" : "Refresh book stock"}</button>{store.configured === false || store.erp !== "msp" ? <a href="/automation" className="mt-2 block text-xs font-normal text-blue-700 underline">Configure store downloads</a> : null}</th>
                {sources.map(([key]) => {
                  const item = rows.find(row => row.store_id === store.id && row.source_type === key);
                  const failed = item?.status === "failed";
                  const freshness = importFreshness(item?.latest_data_date ?? null, key, londonToday());
                  const partial = item?.status === "partial";
                  const statusLabel = failed ? "Latest attempt failed" : partial ? "Completed · product review" : item?.duplicate_of ? "Duplicate report retained" : item?.status === "success" ? "Last attempt succeeded" : item?.status ?? (item?.latest_data_date ? "Saved data · no worker history" : "No report recorded");
                  const phase=['queued','downloading','downloaded','importing','success'].indexOf(item?.status??'');
                  const interrupted=phase>0&&phase<4&&!!item?.started_at&&(Date.now()-Date.parse(item.started_at))>2*3600000;
                  return <td key={key} className="min-w-56 p-3">
                    <p className={`font-medium ${failed ? "text-red-700" : item?.status === "success" ? "text-emerald-700" : "text-amber-700"}`}>{statusLabel}</p>
                    {phase>=0&&phase<4?<progress aria-label={`${store.name} ${key} import progress`} max={4} value={phase} className="mt-1 h-2 w-full" />:null}
                    {phase>=0&&phase<4?<p className="text-xs text-zinc-500">Downloaded rows: {item?.downloaded_row_count??'Waiting for report'}</p>:null}
                    {interrupted?<p role="status" className="text-xs text-red-800">Worker may be interrupted (over 2 hours). Check the office worker and diagnostic log before marking the attempt failed and retrying.</p>:null}
                    {interrupted&&item?.latest_run_id?<details className="mt-2 text-xs"><summary className="cursor-pointer">Recover interrupted import</summary><p>Stop/check the office worker first. Recovery retains the previous data and marks this attempt failed; it does not run the CRM.</p><label className="mt-2 flex items-start gap-1"><input type="checkbox" checked={recoveryConfirmed===String(item.latest_run_id)} onChange={e=>setRecoveryConfirmed(e.target.checked?String(item.latest_run_id):null)} />I have checked that the office worker is stopped</label><button className="mt-2 rounded border p-1" disabled={queueingStore!==null||loading||recoveryConfirmed!==String(item.latest_run_id)} onClick={()=>void recoverImport(item.latest_run_id!,store.id)}>Mark interrupted attempt failed</button></details>:null}
                    <p className="text-xs text-emerald-700">{item?.zero_activity?(key==="rtc"?"Zero RTC activity · Report date available":"Zero wastage · Report date available"):null}</p>
                    <p className="mt-1 text-xs text-zinc-600">Latest data date: {item?.latest_data_date ?? "No data"}</p>
                    <p className="text-xs text-zinc-500">Data updated: {dateLabel(item?.latest_data_updated_at ?? null)}</p>
                    <p className="mt-1 text-xs text-zinc-600">Last worker success: {dateLabel(item?.last_successful_import_at ?? null)}</p>
                    <p className="text-xs text-zinc-500">Rows: {item?.last_successful_row_count ?? "Not reported"}</p>
                    {freshness !== "current" ? <p className="mt-1 text-xs font-medium text-amber-700">{freshness === "missing" ? "Report required" : "Report date is out of date"}</p> : null}
                    {partial ? <details className="mt-2 text-xs"><summary className="cursor-pointer text-amber-800">Why product review?</summary><p className="mt-1 max-w-64">{item?.review_message ?? "Matching rows were saved. Unmatched products need mapping; the import is not a download failure."}</p>{item?.unmatched_identifier_count != null ? <p>{item.unmatched_identifier_count} unmatched identifiers</p> : null}<a href="/unmatched-products" className="mt-1 block text-blue-700 underline">Review unmatched products</a></details> : null}
                    {!item?.last_successful_import_at ? <p className="mt-1 text-xs text-amber-700">No successful worker import recorded</p> : null}
                    {failed ? <p className="mt-1 max-w-56 break-words text-xs text-red-700">{item?.error_message ?? "Import failed"}</p> : null}
                    {failed?<details className="mt-2 text-xs"><summary className="cursor-pointer">Import error details</summary><p>Attempt #{item?.latest_run_id} · {item?.source_start_date??'Date not captured'} to {item?.source_end_date??'Date not captured'}</p><a className="text-blue-700 underline" href={`/api/data-operations/diagnostics?storeId=${store.id}`}>Download safe diagnostic log</a></details>:null}
                    {failed && item?.latest_run_id ? <button type="button" disabled={queueingStore!==null || loading} onClick={()=>void retryImport(item.latest_run_id!,store.id)} aria-label={`Retry ${key==='book_stock'?'book stock':key==='normal_sales'?'normal sales':key==='rtc'?'RTC sales':'wastage'} import for ${store.name}`} className="mt-2 rounded border px-2 py-1 text-xs disabled:opacity-50">Retry import</button> : null}
                  </td>;
                })}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      {data?.configured && stores.length > 0 && coverageFrom && coverageTo ? <details onToggle={e => setCoverageOpen(e.currentTarget.open)} className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Check missing report dates and download</summary>
        <p className="my-3 text-sm text-zinc-600">Choose dates and review missing reports before requesting downloads. Existing reports, including verified zero activity, are retained. Book stock is refreshed manually above.</p>
        <div className="mb-3 flex flex-wrap gap-3"><label className="text-sm">From <input className="rounded border p-2" type="date" value={coverageFrom} onChange={e => setCoverageFrom(e.target.value)} /></label><label className="text-sm">To <input className="rounded border p-2" type="date" value={coverageTo} onChange={e => setCoverageTo(e.target.value)} /></label></div>
        {coverageOpen ? <ReportCoverage storeIds={stores.filter(store => store.erp === "msp").map(store => store.id)} feeds={["normal_sales", "rtc", "wastage"]} from={coverageFrom} to={coverageTo} onQueued={() => void refresh()} /> : null}
      </details> : null}
    </section>
  );
}
