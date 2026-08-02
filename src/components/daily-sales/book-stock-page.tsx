import { AppShell } from "@/components/layout/app-shell";
import { BookStockImportForm } from "@/components/daily-sales/book-stock-import-form";

type Store = { id: number; name: string; code: string; erpType: string };

export function BookStockPageView({ stores }: { stores: Store[] }) {
  return (
    <AppShell
      title="Book Stock"
      description="Import BK files by store. Reuse the latest upload when preparing orders."
    >
      <BookStockImportForm stores={stores} />
    </AppShell>
  );
}
