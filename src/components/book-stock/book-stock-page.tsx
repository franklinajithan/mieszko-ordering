import { AppShell } from "@/components/layout/app-shell";
import { BookStockImportForm } from "@/components/book-stock/book-stock-import-form";
import type { Supplier } from "@/types/supplier";

type Store = { id: number; name: string; code: string; erpType: string };

export function BookStockPageView({
  stores,
  suppliers,
}: {
  stores: Store[];
  suppliers: Supplier[];
}) {
  return (
    <AppShell
      title="Book Stock"
      description="Import BK files by store. Optionally add not-posted and future delivery files; those quantities are added to book stock."
    >
      <BookStockImportForm stores={stores} suppliers={suppliers} />
    </AppShell>
  );
}
