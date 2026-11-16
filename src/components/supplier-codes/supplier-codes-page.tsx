import { AppShell } from "@/components/layout/app-shell";
import { SupplierCodeImportForm } from "@/components/supplier-codes/supplier-code-import-form";

type Store = { id: number; name: string; code: string; erpType: string };

export function SupplierCodesPageView({ stores }: { stores: Store[] }) {
  return (
    <AppShell
      title="Supplier Codes"
      description="Bulk-map MM, SP, and WAB supplier codes to store product codes."
    >
      <SupplierCodeImportForm stores={stores} />
    </AppShell>
  );
}
