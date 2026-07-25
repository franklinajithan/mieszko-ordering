import { AppShell } from "@/components/layout/app-shell";
import { PromoImportForm } from "@/components/imports/promo-import-form";

type Store = { id: number; name: string; code: string; erpType: string };

export function PromoSalesPageView({ stores }: { stores: Store[] }) {
  return (
    <AppShell
      title="Promo Sales"
      description="Import promotional sales quantities by store and date from Excel."
    >
      <PromoImportForm stores={stores} />
    </AppShell>
  );
}
