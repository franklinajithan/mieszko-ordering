import { AppShell } from "@/components/layout/app-shell";
import { DailySalesImportForm } from "@/components/imports/daily-sales-import-form";

type Store = { id: number; name: string; code: string; erpType: string };

export function DailySalesPageView({ stores }: { stores: Store[] }) {
  return (
    <AppShell
      title="Daily Sales Import"
      description="Upload CSV or XLSX sales history and map columns to store products."
    >
      <DailySalesImportForm stores={stores} />
    </AppShell>
  );
}
