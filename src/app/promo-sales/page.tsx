import { AppShell } from "@/components/layout/app-shell";
import { PromoImportForm } from "@/components/imports/promo-import-form";
import { storeRepository } from "@/repositories";

export default async function PromoSalesPage() {
  const stores = await storeRepository.list();

  return (
    <AppShell
      title="Promo Sales"
      description="Import promotional sales quantities by store and date from Excel."
    >
      <PromoImportForm stores={stores} />
    </AppShell>
  );
}
