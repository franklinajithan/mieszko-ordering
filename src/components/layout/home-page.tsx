import type { ReactNode } from "react";
import Link from "next/link";
import {
  BookOpen,
  Activity,
  Clock3,
  ClipboardList,
  ShieldCheck,
  FileSpreadsheet,
  Package,
  Store,
  TrendingUp,
  Truck,
} from "lucide-react";
import { AppShell, NavCard } from "@/components/layout/app-shell";
import { DataOperationsStatus } from "@/components/layout/data-operations-status";

export function HomePageView({ overview }: { overview?: ReactNode }) {
  return (
    <AppShell
      title="Dashboard"
      description="Retail replenishment, stock visibility and data-import operations."
    >
      <div className="space-y-8">
        <section className="relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-6 py-8 text-white shadow-lg sm:px-8 sm:py-10">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-20 right-1/4 h-40 w-40 rounded-full bg-teal-400/20 blur-3xl" />
          <div className="relative max-w-2xl">
            <p className="text-sm font-medium text-emerald-100">Welcome back</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Intelligent retail replenishment
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-emerald-50/90 sm:text-base">
              Import sales history, upload stock files, compare MM / SP / WAB net
              prices, and export completed orders — all in one place.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/order-sheet"
                className="inline-flex items-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50"
              >
                Start order sheet
              </Link>
            </div>
          </div>
        </section>

        {overview}
        <DataOperationsStatus />

        <section className="space-y-4" aria-label="Data operations">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h3 className="text-lg font-semibold text-zinc-900">Data operations</h3><p className="text-sm text-zinc-500">Normal sales and RTC are separate feeds. Check imports before ordering.</p></div>
            <Link href="/order-sheet" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium">Review order readiness →</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { title: "Normal sales", detail: "Independent sales history", icon: TrendingUp, href: "/daily-sales" },
              { title: "RTC sales", detail: "Not included in normal sales", icon: Activity, href: "/rtc" },
              { title: "Wastage", detail: "Separate loss history", icon: ClipboardList, href: "/wastage" },
              { title: "Book stock", detail: "Refresh before ordering", icon: BookOpen, href: "/book-stock" },
            ].map(({ title, detail, icon: Icon, href }) => (
              <Link key={title} href={href} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-emerald-300">
                <Icon className="mb-3 h-5 w-5 text-emerald-700" aria-hidden="true" />
                <p className="font-semibold text-zinc-900">{title}</p><p className="mt-1 text-xs text-zinc-500">{detail}</p>
                <p className="mt-3 text-xs font-medium text-emerald-700">Open →</p>
              </Link>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 font-semibold text-amber-900"><Clock3 className="h-4 w-4" /> Nightly automation</div>
              <p className="mt-2 text-sm text-amber-900/80">Office activation required. The Windows runner is available; verify CRM report mappings before scheduling imports.</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2 font-semibold text-blue-900"><ShieldCheck className="h-4 w-4" /> Book-stock refresh</div>
              <p className="mt-2 text-sm text-blue-900/80">Queue a manual refresh in Import monitoring, or upload a file in Book Stock. The office worker must be configured before queued downloads can run.</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Quick actions
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <NavCard
              href="/products"
              title="Products"
              description="Master products, store codes, barcodes, and supplier mappings."
              icon={Package}
              accent="emerald"
            />
            <NavCard
              href="/daily-sales"
              title="Daily Sales"
              description="Import permanent daily sales history by store."
              icon={TrendingUp}
              accent="blue"
            />
            <NavCard
              href="/supplier-prices"
              title="Supplier Prices"
              description="Import supplier net-price files and preserve history."
              icon={Truck}
              accent="violet"
            />
            <NavCard
              href="/book-stock"
              title="Book Stock"
              description="Import BK files by store and reuse the latest upload in orders."
              icon={BookOpen}
              accent="teal"
            />
            <NavCard
              href="/order-sheet"
              title="Order Sheet"
              description="Generate an order, edit quantities, save a draft, and export to Excel."
              icon={FileSpreadsheet}
              accent="emerald"
            />
            <NavCard
              href="/stores"
              title="Stores & Suppliers"
              description="Manage stores, suppliers, and tie-break priorities."
              icon={Store}
              accent="rose"
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
