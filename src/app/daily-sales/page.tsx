import { AppShell } from "@/components/layout/app-shell";
import { DailySalesImportForm } from "@/components/imports/daily-sales-import-form";
import { storeRepository } from "@/repositories";

export default async function DailySalesPage() {
  const stores = await storeRepository.list();
  return (
    <AppShell title="Daily sales import">
      <DailySalesImportForm stores={stores} />
    </AppShell>
  );
}
