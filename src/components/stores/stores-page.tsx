import { AppShell } from "@/components/layout/app-shell";
import { StoreForm } from "@/components/stores/store-form";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { SupplierList } from "@/components/suppliers/supplier-list";
import type { Store } from "@/types/store";
import type { Supplier } from "@/types/supplier";
import { StoreList } from "@/components/stores/store-list";

export function StoresPageView({
  stores,
  suppliers,
}: {
  stores: Store[];
  suppliers: Supplier[];
}) {
  return (
    <AppShell
      title="Stores & Suppliers"
      description="Configure stores, suppliers, and price tie-break priorities."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Stores</h2>
          <StoreForm />
          <StoreList stores={stores} />
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Suppliers</h2>
          <SupplierForm />
          <SupplierList suppliers={suppliers} />
        </section>
      </div>
    </AppShell>
  );
}
