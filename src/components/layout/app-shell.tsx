import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { isDemoMode } from "@/lib/runtime-config";
import { DesktopSidebar, MobileSidebar } from "@/components/layout/sidebar";
import { cn } from "@/utils/cn";

export function AppShell({
  children,
  title,
  description,
}: {
  children: React.ReactNode;
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-screen bg-[var(--surface)]">
      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {isDemoMode() ? (
          <div className="border-b border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-2 text-center text-sm text-amber-950">
            <span className="font-medium">Demo mode</span> — sample data only. Add{" "}
            <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs">DATABASE_URL</code> to
            persist changes.
          </div>
        ) : null}

        <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/80 px-4 py-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-3 lg:hidden">
                <MobileSidebar />
                <Link href="/" className="text-sm font-semibold text-zinc-900">
                  Mieszko
                </Link>
              </div>
              {title ? (
                <>
                  <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
                    {title}
                  </h1>
                  {description ? (
                    <p className="mt-1 text-sm text-zinc-500">{description}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function NavCard({
  href,
  title,
  description,
  icon: Icon,
  accent = "emerald",
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accent?: "emerald" | "blue" | "violet" | "amber" | "rose" | "teal";
}) {
  const accents = {
    emerald: "from-emerald-500/10 to-teal-500/5 text-emerald-600 ring-emerald-500/20",
    blue: "from-blue-500/10 to-sky-500/5 text-blue-600 ring-blue-500/20",
    violet: "from-violet-500/10 to-purple-500/5 text-violet-600 ring-violet-500/20",
    amber: "from-amber-500/10 to-orange-500/5 text-amber-600 ring-amber-500/20",
    rose: "from-rose-500/10 to-pink-500/5 text-rose-600 ring-rose-500/20",
    teal: "from-teal-500/10 to-cyan-500/5 text-teal-600 ring-teal-500/20",
  };

  return (
    <Link
      href={href}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm",
        "transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md",
      )}
    >
      <div
        className={cn(
          "mb-4 inline-flex rounded-xl bg-gradient-to-br p-3 ring-1 ring-inset",
          accents[accent],
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-base font-semibold text-zinc-900 group-hover:text-emerald-800">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100">
        Open
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-400">{hint}</p> : null}
    </div>
  );
}

export function ImportSummary({
  result,
}: {
  result: {
    totalRows: number;
    matchedRows: number;
    unmatchedRows: number;
    invalidRows: number;
    duplicateRows?: number;
    errors: Array<{ rowNumber: number; reference: string | null; message: string }>;
  };
}) {
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 text-sm">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
          <span className="text-zinc-500">Total</span>
          <p className="font-semibold">{result.totalRows}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2">
          <span className="text-emerald-700">Matched</span>
          <p className="font-semibold text-emerald-900">{result.matchedRows}</p>
        </div>
        <div className="rounded-lg bg-amber-50 px-3 py-2">
          <span className="text-amber-700">Unmatched</span>
          <p className="font-semibold text-amber-900">{result.unmatchedRows}</p>
        </div>
        <div className="rounded-lg bg-red-50 px-3 py-2">
          <span className="text-red-700">Invalid</span>
          <p className="font-semibold text-red-900">{result.invalidRows}</p>
        </div>
        {result.duplicateRows !== undefined ? (
          <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
            <span className="text-zinc-500">Duplicates</span>
            <p className="font-semibold">{result.duplicateRows}</p>
          </div>
        ) : null}
      </div>
      {result.errors.length > 0 ? (
        <div className="max-h-48 overflow-auto rounded-lg border border-zinc-200 bg-white p-3">
          {result.errors.slice(0, 50).map((error, idx) => (
            <p key={idx} className="text-xs text-zinc-700">
              Row {error.rowNumber}: {error.reference ?? "—"} — {error.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
