import { AppShell } from "@/components/layout/app-shell";
import { BookStockImportForm } from "@/components/imports/book-stock-import-form";
import { storeRepository } from "@/repositories";

export default async function BookStockPage() {
  const stores = await storeRepository.list();

  return (
    <AppShell
      title="Book Stock"
      description="Import BK files by store. Reuse the latest upload when preparing orders."
    >
      <BookStockImportForm stores={stores} />
    </AppShell>
  );
}
