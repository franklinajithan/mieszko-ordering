import Link from "next/link";
import { Download, Settings2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { getWeeklyWastageRuns, type WeeklyWastageRun } from "@/services/weekly-wastage.service";
import { RedownloadWeek } from "./redownload";
import { RefreshWastageStatus } from "./refresh";

export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
const labels = { running: "In progress", complete: "Completed", failed: "Failed", waiting: "Waiting", interrupted: "No recent update" };
const badge = {
  running: "bg-sky-100 text-sky-900",
  complete: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
  waiting: "bg-zinc-100 text-zinc-700",
  interrupted: "bg-amber-100 text-amber-900",
};

function Status({ value }: { value: keyof typeof labels }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badge[value]}`}>{labels[value]}</span>;
}

function Run({ run }: { run: WeeklyWastageRun }) {
  const stores = Object.entries(run.stores);
  const done = stores.filter(([, store]) => store.state === "complete").length;
  const failed = stores.filter(([, store]) => store.state === "failed").map(([name]) => name);
  const { stale } = run;
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{day.format(new Date(run.start))} – {day.format(new Date(run.end))}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {stale ? "No recent worker update." : run.state === "failed" && failed.length ? `Failed stores: ${failed.join(", ")}` : run.stage}
            {stores.length > 0 && ` · ${done} of ${stores.length} stores completed`}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Updated {timestamp.format(new Date(run.updatedAt))} UK time</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Status value={stale ? "interrupted" : run.state} />
          <RedownloadWeek week={run.start} running={run.state === "running" && !stale} />
          {run.hasZip && (
            <a
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              href={`/api/weekly-wastage/${run.start}/zip`}
              aria-label={`Download ZIP for week starting ${day.format(new Date(run.start))}`}
            >
              <Download aria-hidden="true" size={16} /> {run.state === "complete" ? "Download ZIP" : "Download previous ZIP"}
            </a>
          )}
        </div>
      </div>
      {stores.length > 0 && (
        <div className="mt-5 border-t border-zinc-200 pt-4">
          <h3 className="text-sm font-semibold text-zinc-800">Store status</h3>
          <progress className="mt-2 h-2 w-full accent-emerald-700" value={done} max={stores.length}
            aria-label="Stores completed" />
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map(([name, store]) => (
              <li key={name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 text-sm">
                <span>{name}</span>
                <span className="flex items-center gap-2">
                  {store.state === "running" && store.attempt && <span className="text-xs text-zinc-600">Attempt {store.attempt} of 3</span>}
                  <Status value={store.state} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default async function WeeklyWastagePage() {
  const { state, runs } = await getWeeklyWastageRuns();
  return (
    <AppShell title="Weekly Wastage" description="Monday at 8:00 am UK time · Reports cover the previous Monday to Sunday">
      <section className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/automation" className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium">
            <Settings2 aria-hidden="true" size={16} /> Store CRM addresses
          </Link>
          {state !== "disabled" && <RefreshWastageStatus />}
        </div>
        {runs.map(run => <Run key={run.start} run={run} />)}
        {runs.length === 0 && (
          <p className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
            {state === "disabled" ? "The reports directory has not been connected to Ordering."
              : state === "unavailable" ? "Ordering could not read weekly wastage status."
              : "Waiting for the first weekly wastage run."}
          </p>
        )}
      </section>
    </AppShell>
  );
}
