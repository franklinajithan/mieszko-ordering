import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/db";
import { dataImportRuns, stores } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Identifier = { value: string; kind: "Barcode" | "Product code" };

export default async function UnmatchedProductsPage() {
  const failures = await db.select({
    id: dataImportRuns.id,
    storeId: dataImportRuns.storeId,
    storeName: stores.name,
    source: dataImportRuns.sourceType,
    date: dataImportRuns.sourceStartDate,
    details: dataImportRuns.details,
  }).from(dataImportRuns)
    .leftJoin(stores, eq(dataImportRuns.storeId, stores.id))
    .where(eq(dataImportRuns.status, "failed"))
    .orderBy(desc(dataImportRuns.id)).limit(1000);

  const grouped = new Map<string, { storeId: number; store: string; identifier: Identifier; jobs: number[]; dates: string[] }>();
  for (const run of failures) {
    if (!run.storeId) continue;
    const details = run.details as Record<string, unknown> | null;
    for (const [field, kind] of [["unmatched_barcodes", "Barcode"], ["unknown_product_codes", "Product code"]] as const) {
      const values = details?.[field];
      if (!Array.isArray(values)) continue;
      for (const raw of values) {
        if (typeof raw !== "string" && typeof raw !== "number") continue;
        const value = String(raw).trim();
        if (!value) continue;
        const key = JSON.stringify([run.storeId, kind, value]);
        let item = grouped.get(key);
        if (!item) {
          item = { storeId: run.storeId, store: run.storeName ?? "Unknown store", identifier: { value, kind }, jobs: [], dates: [] };
          grouped.set(key, item);
        }
        if (!item.jobs.includes(run.id)) item.jobs.push(run.id);
        if (run.date && !item.dates.includes(run.date)) item.dates.push(run.date);
      }
    }
  }
  const items = [...grouped.values()].sort((a, b) => a.store.localeCompare(b.store) || a.identifier.value.localeCompare(b.identifier.value));
  return <AppShell title="Unmatched Products" description="Review unknown CRM identifiers separately from Product Upload. No automatic product creation or guessing.">
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <h2 className="font-semibold">{items.length} unique identifiers requiring review</h2>
        <p className="text-sm text-muted-foreground">Derived from the 1,000 most recent failed jobs. Existing successful imports are unchanged. After updating product details, retry the affected jobs from Download Queue.</p>
        <div className="mt-3 flex gap-3"><Link className="underline" href="/products">Product Upload / Product Master</Link><Link className="underline" href="/downloads">Download Queue</Link></div>
      </div>
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Store</th><th className="p-3">Identifier</th><th className="p-3">Type</th><th className="p-3">Affected jobs</th><th className="p-3">Report dates</th><th className="p-3">Review</th></tr></thead><tbody>
        {items.map(item => <tr className="border-b" key={JSON.stringify([item.storeId, item.identifier.kind, item.identifier.value])}><td className="p-3">{item.store}</td><td className="p-3 font-mono">{item.identifier.value}</td><td className="p-3">{item.identifier.kind}</td><td className="p-3">{item.jobs.map(id => "#" + id).join(", ")}</td><td className="p-3">{item.dates.join(", ")}</td><td className="p-3"><Link className="underline" href={`/products?storeId=${item.storeId}&search=${encodeURIComponent(item.identifier.value)}`}>Review product</Link></td></tr>)}
        {items.length === 0 && <tr><td className="p-4" colSpan={6}>No unmatched identifiers found in recent failed job details.</td></tr>}
      </tbody></table></div>
    </div>
  </AppShell>;
}
