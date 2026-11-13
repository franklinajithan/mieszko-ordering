"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { downloaderApi, downloaderStores, reportNames, type DownloadJob, type DownloadPlan } from "@/lib/report-downloader";

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

export function ReportDownloader() {
  const [plan, setPlan] = useState<DownloadPlan | null>(null);
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

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setPlan(null);
    try {
      const result = await request<{ plan: DownloadPlan }>(downloaderApi, {
        method: "POST", body: new FormData(event.currentTarget),
      });
      setPlan(result.plan);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not review workbooks.");
    } finally {
      setPending(false);
    }
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
        <p className="text-sm text-slate-600">The workbooks select reports, dates and stores. The Ubuntu worker uses the CRM URLs saved in CRM Downloads.</p>
        <form className="flex flex-wrap items-end gap-4" onSubmit={review} onChange={() => setPlan(null)}>
          <label className="grid gap-1 text-sm font-medium">Report_Control.xlsx
            <input className="max-w-full rounded-md border p-2" name="control" type="file" accept=".xlsx" required disabled={pending} />
          </label>
          <label className="grid gap-1 text-sm font-medium">Stores.xlsx
            <input className="max-w-full rounded-md border p-2" name="stores" type="file" accept=".xlsx" required disabled={pending} />
          </label>
          <Button disabled={pending} type="submit">Review selection</Button>
        </form>
        {plan && <div className="grid gap-3 rounded-md border p-3">
          <p className="text-sm"><strong>Stores</strong> {plan.stores.map(store => downloaderStores[store]).join(", ")}</p>
          <ul className="grid gap-1 text-sm">
            {plan.ranges.map((row, i) => <li key={i}>{reportNames[row.report]} · {row.start} to {row.end}</li>)}
          </ul>
          <div><Button disabled={pending || enabled !== true || busy} onClick={() => start(plan)}>Start downloads</Button></div>
        </div>}
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
