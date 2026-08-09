import { AppShell } from "@/components/layout/app-shell";
import { PromoImportForm } from "@/components/promo-sales/promo-import-form";
import type { StoreOption } from "@/types/store";

export function PromoSalesPageView({ stores }: { stores: StoreOption[] }) {
  return (
    <AppShell
      title="Promo Sales"
      description="Import promo quantities by store and date from Excel (MSP Promotion Item Detail or legacy files)."
    >
      <PromoImportForm stores={stores} />
    </AppShell>
  );
}
