"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadPlan, downloaderApi, downloaderStores, reportNames, type DownloadJob, type DownloadPlan } from "@/lib/report-downloader";

type Range = DownloadPlan["ranges"][number];
type Store = DownloadPlan["stores"][number];
type RangeRow = Range & { id: number };
const storeCodes = Object.keys(downloaderStores) as Store[];
const reports = Object.keys(reportNames) as Range["report"][];

type Summary = Pick<DownloadJob, "id" | "startedAt" | "state"> & { total: number };
const labels = { waiting: "Waiting", running: "Running", completed: "Completed", skipped: "Already saved", failed: "Failed" };
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const tableCell = "px-3 py-2 text-left";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}

export function ReportDownloader({ today, yesterday }: { today: string; yesterday: string }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [ranges, setRanges] = useState<RangeRow[]>([{ id: 0, report: "item_sales", start: yesterday, end: yesterday }]);
  const nextId = useRef(1);
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [id, setId] = useState("");
  const [history, setHistory] = useState<Summary[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const list = await request<{ enabled: boolean; history: Summary[] }>(downloaderApi, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setHistory(list.history);
        setEnabled(list.enabled);
        const selected = id || list.history[0]?.id;
        const result = selected ? await request<DownloadJob>(`${downloaderApi}/${selected}`, { signal: controller.signal }) : null;
        if (controller.signal.aborted) return;
        setJob(result);
        setLoadError("");
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not refresh downloads.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id]);

  function addRange(report: Range["report"]) {
    const id = nextId.current++;
    setRanges(rows => [...rows, { id, report, start: yesterday, end: yesterday }]);
  }

  function updateRange(id: number, field: "start" | "end", value: string) {
    setRanges(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row));
  }

  async function start(selection: DownloadPlan) {
    setPending(true);
    setError("");
    try {
      const result = await request<{ id: string }>(downloaderApi, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection),
      });
      setJob(null);
      setId(result.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not start downloads.");
    } finally {
      setPending(false);
    }
  }

  const busy = history.some(row => row.state === "running") || job?.state === "running";
  const finished = job?.reports.filter(row => row.state !== "waiting" && row.state !== "running").length ?? 0;

  return (
    <div className="grid gap-5">
      <section className="grid gap-4 rounded-xl border bg-white p-5">
        <h2 className="text-lg font-semibold">Download setup</h2>
        <form className="grid gap-5" onSubmit={event => {
          event.preventDefault();
          const selection = downloadPlan.safeParse({ stores, ranges });
          if (!selection.success || ranges.some(row => row.end > today)) {
            setError("Select at least one store and one valid date range. Each range can span up to 366 days and must end today or earlier.");
            return;
          }
          void start(selection.data);
        }}>
          <fieldset className="grid gap-2" disabled={pending}>
            <legend className="mb-2 font-medium">Stores</legend>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" type="button" onClick={() => setStores(stores.length === storeCodes.length ? [] : storeCodes)}>
                {stores.length === storeCodes.length ? "Clear stores" : "Select all stores"}
              </Button>
              {storeCodes.map(store => <label key={store} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={stores.includes(store)} onChange={event => {
                  const checked = event.target.checked;
                  setStores(previous => checked ? [...previous, store] : previous.filter(code => code !== store));
                }} />
                {downloaderStores[store]}
              </label>)}
            </div>
            <Link href="/automation" className="w-fit text-sm text-blue-700 underline">Manage shop URLs in CRM Downloads</Link>
          </fieldset>

          <fieldset className="grid gap-3" disabled={pending}>
            <legend className="mb-2 font-medium">Reports and date ranges</legend>
            <p className="text-sm text-slate-600">Add a date range to run a report. Each range creates one Excel file per selected store.</p>
            {reports.map(report => {
              const rows = ranges.filter(row => row.report === report);
              const limit = report === "item_sales" ? 10 : report === "daily_item_volume" ? 1 : 50;
              return <section key={report} className="grid gap-3 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{reportNames[report]}</h3>
                  <Button variant="outline" size="sm" type="button" aria-label={`Add date range for ${reportNames[report]}`}
                    disabled={rows.length >= limit || ranges.length >= 50} onClick={() => addRange(report)}>Add date range</Button>
                </div>
                {rows.map(row => <div className="flex flex-wrap items-end gap-3" key={row.id}>
                  <label className="grid gap-1 text-sm">From date
                    <Input type="date" required value={row.start} max={today} onChange={event => updateRange(row.id, "start", event.target.value)} />
                  </label>
                  <label className="grid gap-1 text-sm">To date
                    <Input type="date" required value={row.end} min={row.start} max={today} onChange={event => updateRange(row.id, "end", event.target.value)} />
                  </label>
                  <Button variant="outline" type="button" onClick={() => setRanges(previous => previous.filter(item => item.id !== row.id))}>Remove range</Button>
                </div>)}
              </section>;
            })}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || enabled !== true || busy || !stores.length || !ranges.length}>Start downloads</Button>
            <p className="text-sm text-slate-600">{stores.length} selected stores · {ranges.length} date ranges</p>
          </div>
        </form>
        {enabled === false && <p className="text-sm text-amber-800">Run downloads from the office app with the Ubuntu worker configured.</p>}
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      </section>
      <section className="grid gap-4 rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Recent runs</h2>
          {history.length > 0 && <label className="text-sm">Run <select className="rounded-md border p-2" value={id || history[0].id} onChange={event => {
            setId(event.target.value);
            setJob(null);
          }}>
            {id && !history.some(run => run.id === id) && <option value={id}>Loading run…</option>}
            {history.map(run => <option key={run.id} value={run.id}>{dateFormat.format(run.startedAt)} · {labels[run.state]} · {run.total} reports</option>)}
          </select></label>}
        </div>
        {loadError && <p className="text-sm text-red-700" role="status">{loadError}</p>}
        {!job && <p className="text-sm text-slate-600">{id || history.length ? "Loading run…" : enabled === null ? "Loading history…" : "No download runs yet."}</p>}
        {job && <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm" role="status">{finished} of {job.reports.length} processed · {labels[job.state]}</p>
            <progress className="max-w-full" aria-label="Reports processed" value={finished} max={job.reports.length} />
            {job.zipReady && <Button asChild><a href={`${downloaderApi}/${job.id}/zip`}>Download completed reports as ZIP</a></Button>}
            {job.state === "failed" && job.reports.some(row => row.state === "failed") && <Button variant="outline" disabled={pending || enabled !== true || busy}
              onClick={() => start({
                stores: [...new Set(job.reports.map(row => row.store))],
                ranges: [...new Map(job.reports.map(({ report, start, end }) => [`${report}/${start}/${end}`, { report, start, end }])).values()],
              })}>Retry missing reports</Button>}
          </div>
          {job.error && <p className="text-sm text-red-700" role="status">{job.error}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100"><tr>{["Store", "Report", "From", "To", "Status"].map(label => <th scope="col" className={tableCell} key={label}>{label}</th>)}</tr></thead>
              <tbody>{job.reports.map(row => <tr className="border-b" key={`${row.store}/${row.report}/${row.start}/${row.end}`}>
                <td className={tableCell}>{downloaderStores[row.store]}</td><td className={tableCell}>{reportNames[row.report]}</td>
                <td className={tableCell}>{row.start}</td><td className={tableCell}>{row.end}</td>
                <td className={tableCell}>{labels[row.state]}{row.message && <span className="block text-xs text-slate-600">{row.message}</span>}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </>}
      </section>
    </div>
  );
}
