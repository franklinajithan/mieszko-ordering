import { AppShell } from "@/components/layout/app-shell";
import { DailySalesImportForm } from "@/components/imports/daily-sales-import-form";
import { storeRepository } from "@/repositories";

export default async function DailySalesPage() {
  const stores = await storeRepository.list();
  return (
    <AppShell
      title="Daily Sales Import"
      description="Upload CSV or XLSX sales history and map columns to store products."
    >
      <DailySalesImportForm stores={stores} />
    </AppShell>
  );
}
