"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Play } from "lucide-react";
import type { DailyWastageRun } from "@/services/daily-wastage-run.service";

type Pdf = { storeId: number; filename: string };
const button = "inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50";
const statusLabels = { waiting: "Waiting", running: "Downloading", complete: "Ready", failed: "Failed" };

export function WastageActions({ date, files, manual }: { date: string; files: Pdf[]; manual: boolean }) {
  const router = useRouter();
  const [run, setRun] = useState<DailyWastageRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState("");
  const [bulk, setBulk] = useState({ active: false, done: 0, total: 0, failed: [] as string[] });
  const runUrl = `/api/daily-wastage/${date}/run`;
  const running = run?.state === "running";

  useEffect(() => {
    if (!manual) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let previous: DailyWastageRun | null = null;
    async function poll() {
      try {
        const response = await fetch(runUrl, { cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error("Progress is unavailable.");
        const status = await response.json() as DailyWastageRun | null;
        if (abort.signal.aborted) return;
        setRun(status);
        setRunError(error => error === "Progress is unavailable." ? "" : error);
        const completed = status?.stores.filter(store => store.state === "complete").length ?? 0;
        const previousCompleted = previous?.stores.filter(store => store.state === "complete").length ?? 0;
        if (previous && (completed > previousCompleted || (previous.state === "running" && status?.state !== "running"))) {
          router.refresh();
        }
        previous = status;
      } catch {
        if (!abort.signal.aborted) setRunError(error => error || "Progress is unavailable.");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 2500);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [manual, router, runUrl]);

  async function startRun(storeId?: number) {
    setStarting(true);
    setRunError("");
    try {
      const url = storeId === undefined ? runUrl : `${runUrl}?storeId=${storeId}`;
      const response = await fetch(url, { method: "POST" });
      const status = await response.json();
      if (!response.ok) {
        setRunError(status.error ?? "Could not start the PDF export.");
        return;
      }
      setRun(status);
      router.refresh();
    } catch {
      setRunError("Could not start the PDF export.");
    } finally {
      setStarting(false);
    }
  }

  async function downloadAll() {
    const failed: string[] = [];
    setBulk({ active: true, done: 0, total: files.length, failed: [] });
    for (const [index, file] of files.entries()) {
      try {
        const response = await fetch(`/api/daily-wastage/${date}/${file.storeId}`, { cache: "no-store" });
        if (!response.ok || !response.headers.get("Content-Type")?.startsWith("application/pdf")) {
          throw new Error("PDF unavailable");
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = file.filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        failed.push(file.filename);
      }
      setBulk({ active: index + 1 < files.length, done: index + 1, total: files.length, failed: [...failed] });
    }
  }

  const finished = run?.stores.filter(store => store.state === "complete" || store.state === "failed").length ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={downloadAll} disabled={!files.length || bulk.active}>
          <Download size={16} aria-hidden="true" /> Download all PDFs{files.length ? ` (${files.length})` : ""}
        </button>
        {manual && (
          <button type="button" className={button} onClick={() => startRun()} disabled={starting || running}>
            <Play size={16} aria-hidden="true" /> {starting ? "Starting export…" : "Run PDF export"}
          </button>
        )}
      </div>
      {bulk.total > 0 && (
        <div role="status" className="text-sm text-zinc-700">
          {bulk.active ? `Preparing PDFs: ${bulk.done} of ${bulk.total} processed.`
            : `${bulk.done - bulk.failed.length} of ${bulk.total} downloads sent to your browser. Allow multiple downloads if prompted.`}
          {bulk.failed.length > 0 && <p>Unavailable: {bulk.failed.join(", ")}</p>}
          {bulk.active && <progress className="block w-full accent-emerald-700" value={bulk.done} max={bulk.total} aria-label="PDF download progress" />}
        </div>
      )}
      {runError && <p role="alert" className="text-sm text-red-800">{runError}</p>}
      {run && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p role="status" className="text-sm font-medium">
            {running && run.stores.length ? `${finished} of ${run.stores.length} stores processed` : run.message}
          </p>
          {run.stores.length > 0 && (
            <>
              <progress className="mt-2 block w-full accent-emerald-700" value={finished} max={run.stores.length} aria-label="Nibua export progress" />
              <ul className="mt-2 divide-y divide-zinc-100 text-sm">
                {run.stores.map(store => (
                  <li key={store.id} className="grid gap-1 py-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-center">
                    <span className="font-medium">{store.name}</span>
                    <span className={store.state === "failed" ? "text-red-800" : "text-zinc-700"}>{statusLabels[store.state]}</span>
                    <span className="text-zinc-600">{store.step}</span>
                    {manual && store.state === "failed" && (
                      <button type="button" className={button} onClick={() => startRun(store.id)}
                        disabled={starting || running} aria-label={`Redownload PDF for ${store.name}`}>
                        Redownload PDF
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
