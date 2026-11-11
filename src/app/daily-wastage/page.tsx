import { Download } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { dailyWastageDate, listDailyWastage } from "@/services/daily-wastage.service";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import { ReportDate } from "./report-date";

export const dynamic = "force-dynamic";

export default async function DailyWastagePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const query = await searchParams;
  const selected = dailyWastageDate.safeParse(query.date);
  const date = selected.data ?? addDaysIso(todayIso(), -1);
  const archive = await listDailyWastage(date);

  return (
    <AppShell title="Daily Wastage Files" description="Original Nibua wastage exports by store and report date.">
      <section className="max-w-4xl space-y-4">
        <ReportDate key={date} date={date} />
        {query.date !== undefined && !selected.success && (
          <p role="alert" className="text-sm text-red-800">Invalid report date. Showing yesterday’s files.</p>
        )}
        {archive.state !== "ready" || archive.stores.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
            {archive.state === "disabled" ? "The daily download archive has not been connected to Ordering."
              : archive.state === "unavailable" ? "Ordering could not read the daily download archive."
                : "No stores are configured."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-700">
                <tr><th scope="col" className="px-4 py-3">Store</th><th scope="col" className="px-4 py-3">Wastage file</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {archive.stores.map(({ storeId, name, filename }) => (
                  <tr key={storeId}>
                    <th scope="row" className="px-4 py-3 font-medium">{name}</th>
                    <td className="px-4 py-3">
                      {filename ? (
                        <a className="inline-flex items-center gap-2 font-medium text-emerald-800 hover:underline"
                          href={`/api/daily-wastage/${date}/${storeId}`}
                          aria-label={`Download original wastage file for ${name}`}>
                          <Download size={16} aria-hidden="true" /> {filename}
                        </a>
                      ) : <span className="text-zinc-600">No file available</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
