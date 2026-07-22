import Link from "next/link";
import { isDemoMode } from "@/lib/runtime-config";
import { cn } from "@/utils/cn";

const links = [
  { href: "/products", label: "Products" },
  { href: "/daily-sales", label: "Daily Sales" },
  { href: "/supplier-prices", label: "Supplier Prices" },
  { href: "/orders/new", label: "New Order" },
  { href: "/orders", label: "Order History" },
  { href: "/stores", label: "Stores and Suppliers" },
];

export function AppShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="min-h-screen bg-zinc-50">
      {isDemoMode() ? (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-sm text-amber-950">
          Demo mode — UI preview with sample data. Set{" "}
          <code className="rounded bg-white px-1">DATABASE_URL</code> in{" "}
          <code className="rounded bg-white px-1">.env</code> to persist data.
        </div>
      ) : null}
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-lg font-semibold text-zinc-900">
              Mieszko Ordering
            </Link>
            {title ? (
              <p className="text-sm text-zinc-600">{title}</p>
            ) : null}
          </div>
          <nav className="flex flex-wrap gap-3 text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-zinc-700 hover:text-zinc-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}

export function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-400 hover:shadow",
      )}
    >
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <p className="mt-2 text-sm text-zinc-600">{description}</p>
    </Link>
  );
}

export function ImportSummary({ result }: { result: {
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  invalidRows: number;
  duplicateRows?: number;
  errors: Array<{ rowNumber: number; reference: string | null; message: string }>;
} }) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <div>Total: {result.totalRows}</div>
        <div className="text-emerald-700">Matched: {result.matchedRows}</div>
        <div className="text-amber-700">Unmatched: {result.unmatchedRows}</div>
        <div className="text-red-700">Invalid: {result.invalidRows}</div>
        {result.duplicateRows !== undefined ? (
          <div>Duplicates: {result.duplicateRows}</div>
        ) : null}
      </div>
      {result.errors.length > 0 ? (
        <div className="max-h-48 overflow-auto rounded border bg-white p-3">
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
