import { AppShell } from "@/components/layout/app-shell";
import { WastageImportForm } from "@/components/wastage/wastage-import-form";
import type { StoreOption } from "@/types/store";

export function WastagePageView({ stores }: { stores: StoreOption[] }) {
  return (
    <AppShell
      title="Wastage"
      description="Import wastage quantities by store and date from Excel (MSP Stock Adjustment, GloPOS WastageReport, or Sudbury stock variance)."
    >
      <WastageImportForm stores={stores} />
    </AppShell>
  );
}
