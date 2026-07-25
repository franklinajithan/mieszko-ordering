import { AppShell } from "@/components/layout/app-shell";
import { WastageImportForm } from "@/components/imports/wastage-import-form";

type Store = { id: number; name: string; code: string; erpType: string };

export function WastagePageView({ stores }: { stores: Store[] }) {
  return (
    <AppShell
      title="Wastage"
      description="Import wastage quantities by store and date from Excel."
    >
      <WastageImportForm stores={stores} />
    </AppShell>
  );
}
