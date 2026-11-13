"use client";

import { useEffect, useState } from "react";
import { Download, Play, RotateCcw, Square } from "lucide-react";
import {
  report6Api, report6Date, report6Days, report6Filename, report6Stores, report6ZipFilename,
  type Report6Job, type Report6Key, type Report6Store, type Report6Summary,
} from "@/lib/item-sales-enquiry";

const stores = Object.entries(report6Stores) as [Report6Store, string][];
const panel = "space-y-4 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5";
const button = "inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50";
const primary = "inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50";
const workbookType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function key(row: Report6Key) {
  return `${row.store}/${row.date}`;
}

function hasFile(row: Report6Job["reports"][number]) {
  return row.state === "completed" || row.state === "skipped";
}

function stamp(value: number) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/London",
  }).format(value);
}

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ItemSalesEnquiry({ today, initialDate }: { today: string; initialDate: string }) {
  const [archiveDate, setArchiveDate] = useState(initialDate);
  const [archive, setArchive] = useState<{ date: string; available: Report6Store[] } | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [zip, setZip] = useState<{ running: boolean; message: string; error?: boolean }>({ running: false, message: "" });
  const validArchiveDate = report6Date.safeParse(archiveDate).success && archiveDate <= today;
  const archiveUrl = `${report6Api}/archive/${archiveDate}`;
  const available = archive?.date === archiveDate ? archive.available : null;
  const missingStores = available ? stores.filter(([store]) => !available.includes(store)).map(([, name]) => name) : [];
  const [start, setStart] = useState(initialDate);
  const [end, setEnd] = useState(initialDate);
  const [selectedStores, setStores] = useState<Report6Store[]>(stores.map(([store]) => store));
  const [history, setHistory] = useState<Report6Summary[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<Report6Job | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [bulk, setBulk] = useState({ running: false, done: 0, total: 0, failed: 0 });
  const [now, setNow] = useState(0);
  const dayCount = report6Days(start, end);
  const validRange = dayCount >= 1 && dayCount <= 366 && end <= today;
  const running = history.some(row => row.state === "running") || job?.state === "running";
  const locked = enabled !== true || running || busy;

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(report6Api, { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json() as { enabled: boolean; history: Report6Summary[] };
        const id = jobId || data.history[0]?.id;
        let current: Report6Job | null = null;
        if (id) {
          const result = await fetch(`${report6Api}/${id}`, { signal: abort.signal, cache: "no-store" });
          if (!result.ok) throw new Error();
          current = await result.json() as Report6Job;
        }
        if (abort.signal.aborted) return;
        setEnabled(data.enabled);
        setHistory(data.history);
        setJob(current);
        setNow(Date.now());
        setPollError("");
      } catch {
        if (!abort.signal.aborted) setPollError("Report 6 history or progress is temporarily unavailable.");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 2500);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [jobId]);

  useEffect(() => {
    if (!validArchiveDate) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(archiveUrl, { signal: abort.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const { available } = await response.json() as { available: Report6Store[] };
        if (abort.signal.aborted) return;
        setArchive({ date: archiveDate, available });
        setArchiveError("");
      } catch {
        if (abort.signal.aborted) return;
        setArchive(null);
        setArchiveError("Could not check archived reports. Retrying…");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 2500);
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [archiveDate, archiveUrl, validArchiveDate]);

  function selectArchiveDate(date: string) {
    setArchiveDate(date);
    setArchiveError("");
    setZip(previous => previous.running ? previous : { running: false, message: "" });
  }

  async function downloadZip() {
    setZip({ running: true, message: `Preparing ZIP for ${archiveDate}…` });
    try {
      const response = await fetch(`${archiveUrl}?download=zip`, { cache: "no-store" });
      if (response.status === 404) throw new Error("No archived workbooks are available for this date.");
      if (!response.ok || response.headers.get("Content-Type") !== "application/zip") {
        throw new Error("Could not download the ZIP. Try again.");
      }
      saveDownload(await response.blob(), report6ZipFilename(archiveDate));
      setZip({ running: false, message: `ZIP for ${archiveDate} sent to your browser.` });
    } catch (error) {
      setZip({ running: false, message: error instanceof Error ? error.message : "ZIP download failed.", error: true });
    }
  }

  async function submit(payload?: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(payload ? report6Api : `${report6Api}/${job?.id}`, {
        method: "POST",
        ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Report 6 request failed.");
      if (payload) {
        setJobId(data.id);
        setJob(null);
        setSelected([]);
      } else {
        setJob(previous => previous ? { ...previous, cancelling: true } : previous);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Report 6 request failed.");
    } finally {
      setBusy(false);
    }
  }

  const rows = job?.reports ?? [];
  const files = rows.filter(hasFile);
  const failed = rows.filter(row => row.state === "failed").length;
  const skipped = rows.filter(row => row.state === "skipped").length;
  const completed = files.length - skipped;
  const processed = completed + skipped + failed;
  const storeCount = new Set(rows.map(row => row.store)).size;
  const percent = rows.length ? Math.round(100 * processed / rows.length) : 0;
  const elapsed = job ? Math.max(0, Math.floor(((job.finishedAt ?? now) - job.startedAt) / 1000)) : 0;

  async function downloadAll() {
    let failures = 0;
    setBulk({ running: true, done: 0, total: files.length, failed: 0 });
    for (const [index, row] of files.entries()) {
      try {
        const response = await fetch(`${report6Api}/files/${key(row)}`);
        if (!response.ok || response.headers.get("Content-Type") !== workbookType) throw new Error();
        saveDownload(await response.blob(), report6Filename(row));
      } catch {
        failures++;
      }
      setBulk({ running: index + 1 < files.length, done: index + 1, total: files.length, failed: failures });
    }
  }

  return (
    <div className="space-y-5">
      <section className={panel} id="report6-archive" aria-labelledby="report6-archive-title">
        <h2 id="report6-archive-title" className="text-lg font-semibold">Archived reports</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">ZIP report date
            <input type="date" className="rounded-lg border border-zinc-300 px-3 py-2" max={today}
              value={archiveDate} onChange={event => selectArchiveDate(event.target.value)} />
          </label>
          <button className={primary} disabled={!validArchiveDate || !available?.length || zip.running} onClick={downloadZip}>
            <Download size={16} aria-hidden="true" /> Download All as ZIP
            {available && ` (${available.length}/${stores.length} stores)`}
          </button>
        </div>
        <div role="status" className="text-sm text-zinc-600">
          {!validArchiveDate ? "Select a valid report date." : archiveError || (
            available === null ? "Checking archived reports…" : missingStores.length
              ? `Missing stores: ${missingStores.join(", ")}.`
              : "All seven stores are available."
          )}
        </div>
        {zip.message && <p role={zip.error ? "alert" : "status"} className={zip.error ? "text-sm text-red-800" : "text-sm text-zinc-600"}>{zip.message}</p>}
      </section>

      <section className={panel} aria-labelledby="report6-new">
        <h2 id="report6-new" className="text-lg font-semibold">New download</h2>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          void submit({ action: "start", start, end, stores: selectedStores });
        }}>
          <div className="flex flex-wrap gap-4">
            <label className="grid gap-1 text-sm font-medium">Start date
              <input type="date" className="rounded-lg border border-zinc-300 px-3 py-2" required max={today} value={start} onChange={event => setStart(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium">End date
              <input type="date" className="rounded-lg border border-zinc-300 px-3 py-2" required min={start || undefined} max={today} value={end} onChange={event => setEnd(event.target.value)} />
            </label>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Stores</legend>
            <div className="flex flex-wrap gap-2">
              {stores.map(([store, name]) => (
                <label key={store} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                  <input type="checkbox" className="accent-emerald-700" checked={selectedStores.includes(store)}
                    onChange={event => setStores(previous => event.target.checked ? [...previous, store] : previous.filter(value => value !== store))} />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-sm text-zinc-600">
            {validRange ? `${start} to ${end} · ${selectedStores.length} stores · ${dayCount * selectedStores.length} expected files`
              : "Select up to 366 days, ending today or earlier."}
          </p>
          <button className={primary} disabled={locked || !validRange || !selectedStores.length}>
            <Play size={16} aria-hidden="true" /> Start Download
          </button>
        </form>
        {enabled === false && <p className="text-sm text-zinc-600">The Ubuntu Report 6 worker and archive are not configured.</p>}
        {(error || pollError) && <p role="alert" className="text-sm text-red-800">{error || pollError}</p>}
      </section>

      {history.length > 0 && (
        <section className={panel} aria-labelledby="report6-history">
          <h2 id="report6-history" className="text-lg font-semibold">Report history</h2>
          <label className="grid gap-1 text-sm font-medium sm:max-w-lg">Download job
            <select className="rounded-lg border border-zinc-300 px-3 py-2" value={jobId || history[0].id}
              onChange={event => { setJobId(event.target.value); setJob(null); setSelected([]); }}>
              {history.map(entry => (
                <option key={entry.id} value={entry.id}>
                  {stamp(entry.startedAt)} · {entry.start} to {entry.end} · {entry.state} · {entry.total} reports
                </option>
              ))}
            </select>
          </label>
          {job && (
            <>
              <div className="flex flex-wrap gap-2">
                <button className={button} disabled={locked || !failed} onClick={() => submit({ action: "retry", id: job.id })}>
                  <RotateCcw size={16} aria-hidden="true" /> Retry Failed
                </button>
                <button className={button} disabled={locked || !selected.length} onClick={() => submit({
                  action: "redownload", reports: rows.filter(row => selected.includes(key(row))).map(({ store, date }) => ({ store, date })),
                })}>Redownload Selected</button>
                <button className={button} disabled={busy || job.state !== "running" || job.cancelling} onClick={() => submit()}>
                  <Square size={16} aria-hidden="true" /> {job.cancelling ? "Cancelling…" : "Cancel Job"}
                </button>
                <a className={button} href="#report6-archive" onClick={() => selectArchiveDate(job.start)}>
                  <Download size={16} aria-hidden="true" /> ZIP by Date
                </a>
                <button className={button} disabled={!files.length || bulk.running} onClick={downloadAll}>
                  <Download size={16} aria-hidden="true" /> Download All ({files.length})
                </button>
              </div>
              {bulk.total > 0 && <p role="status" className="text-sm text-zinc-600">
                {bulk.running ? `Preparing ${bulk.done} of ${bulk.total} workbooks…` :
                  `${bulk.done - bulk.failed} of ${bulk.total} downloads sent to your browser. Allow multiple downloads if prompted.`}
                {bulk.failed > 0 && ` ${bulk.failed} unavailable.`}
              </p>}
              <div className="rounded-lg bg-zinc-50 p-3 text-sm">
                <p role="status" className="font-medium capitalize">{job.cancelling ? "Cancellation requested" : job.state} · {percent}% processed
                  {job.current && ` · ${report6Stores[job.current.store]} · ${job.current.date}`}
                </p>
                <progress className="my-2 block w-full accent-emerald-700" value={processed} max={rows.length} aria-label="Overall report progress" />
                <p>{storeCount} stores · {rows.length} reports · {completed} completed · {skipped} skipped · {failed} failed</p>
                <p className="mt-1 text-zinc-600">Started {stamp(job.startedAt)} · Elapsed {Math.floor(elapsed / 60)}m {elapsed % 60}s</p>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {stores.filter(([store]) => rows.some(row => row.store === store)).map(([store, name]) => {
                  const reports = rows.filter(row => row.store === store);
                  const count = reports.filter(row => hasFile(row) || row.state === "failed").length;
                  const status = reports.some(row => row.state === "running") ? "Downloading"
                    : reports.some(row => row.state === "waiting") ? "Waiting"
                    : reports.some(row => row.state === "cancelled") ? "Cancelled"
                    : reports.some(row => row.state === "failed") ? "Has failures" : "Ready";
                  return <li key={store} className="rounded-lg border border-zinc-200 p-3 text-sm">
                    <p className="font-medium">{name}</p>
                    <p className="text-zinc-600">{status} · {count}/{reports.length}</p>
                    <progress className="block w-full accent-emerald-700" value={count} max={reports.length} aria-label={`${name} progress`} />
                  </li>;
                })}
              </ul>
              <div className="max-h-[32rem] overflow-auto rounded-lg border border-zinc-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-50">
                    <tr>{["Select", "Store", "Date", "Status", "Workbook"].map(label => <th key={label} scope="col" className="px-3 py-2">{label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.map(row => <tr key={key(row)}>
                      <td className="px-3 py-2"><input type="checkbox" className="accent-emerald-700" aria-label={`Select ${report6Stores[row.store]} ${row.date}`}
                        checked={selected.includes(key(row))} onChange={event => setSelected(previous => event.target.checked
                          ? [...previous, key(row)] : previous.filter(value => value !== key(row)))} /></td>
                      <td className="px-3 py-2">{report6Stores[row.store]}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <a href="#report6-archive" className="hover:underline" onClick={() => selectArchiveDate(row.date)}
                          aria-label={`Select ${row.date} for ZIP download`}>{row.date}</a>
                      </td>
                      <td className="px-3 py-2"><span className={`capitalize ${row.state === "failed" ? "font-medium text-red-800" : ""}`}>{row.state}</span>
                        {row.message && <p className="text-xs text-zinc-600">{row.message}</p>}</td>
                      <td className="px-3 py-2">{hasFile(row) && <a className="font-medium text-emerald-800 hover:underline"
                        href={`${report6Api}/files/${key(row)}`} aria-label={`Download ${report6Filename(row)}`}>Download Excel</a>}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
