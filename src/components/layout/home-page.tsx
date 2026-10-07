import Link from "next/link";
import {
  BookOpen,
  FileSpreadsheet,
  Package,
  Store,
  TrendingUp,
  Truck,
} from "lucide-react";
import { AppShell, NavCard } from "@/components/layout/app-shell";

export function HomePageView() {
  return (
    <AppShell
      title="Dashboard"
      description="Replace Excel-based dairy ordering with stock simulation and supplier price comparison."
    >
      <div className="space-y-8">
        <section className="relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-6 py-8 text-white shadow-lg sm:px-8 sm:py-10">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-20 right-1/4 h-40 w-40 rounded-full bg-teal-400/20 blur-3xl" />
          <div className="relative max-w-2xl">
            <p className="text-sm font-medium text-emerald-100">Welcome back</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Prepare smarter dairy orders
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
