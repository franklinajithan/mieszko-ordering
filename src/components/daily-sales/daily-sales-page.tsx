import { AppShell } from "@/components/layout/app-shell";
import { DailySalesImportForm } from "@/components/daily-sales/daily-sales-import-form";
import type { StoreOption } from "@/types/store";

export function DailySalesPageView({ stores }: { stores: StoreOption[] }) {
  return (
    <AppShell
      title="Daily Sales"
      description="Import daily sales quantities by store and date from Excel."
    >
      <DailySalesImportForm stores={stores} />
    </AppShell>
  );
}
