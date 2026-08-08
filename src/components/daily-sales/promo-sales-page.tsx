import { AppShell } from "@/components/layout/app-shell";
import { PromoImportForm } from "@/components/daily-sales/promo-import-form";
import type { StoreOption } from "@/types/store";

export function PromoSalesPageView({ stores }: { stores: StoreOption[] }) {
  return (
    <AppShell
      title="Promo Sales"
      description="Import promotional sales quantities by store and date from Excel."
    >
      <PromoImportForm stores={stores} />
    </AppShell>
  );
}
