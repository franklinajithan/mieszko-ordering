import { AppShell } from "@/components/layout/app-shell";
import { WastageImportForm } from "@/components/imports/wastage-import-form";
import { storeRepository } from "@/repositories";

export default async function WastagePage() {
  const stores = await storeRepository.list();

  return (
    <AppShell
      title="Wastage"
      description="Import wastage quantities by store and date from Excel."
    >
      <WastageImportForm stores={stores} />
    </AppShell>
  );
}
