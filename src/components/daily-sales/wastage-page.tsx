import { AppShell } from "@/components/layout/app-shell";
import { WastageImportForm } from "@/components/daily-sales/wastage-import-form";

type Store = { id: number; name: string; code: string; erpType: string };

export function WastagePageView({ stores }: { stores: Store[] }) {
  return (
    <AppShell
      title="Wastage"
      description="Import wastage quantities by store and date from Excel (GloPOS WastageReport or legacy files)."
    >
      <WastageImportForm stores={stores} />
    </AppShell>
  );
}
