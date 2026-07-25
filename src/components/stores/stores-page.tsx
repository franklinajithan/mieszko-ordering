import { AppShell } from "@/components/layout/app-shell";
import {
  StoreErpSelect,
  StoreToggleButton,
} from "@/components/stores/store-actions";
import { StoreForm } from "@/components/stores/store-form";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { SupplierList } from "@/components/suppliers/supplier-list";
import { Badge } from "@/components/ui/badge";
import type { Store } from "@/types/store";
import type { Supplier } from "@/types/supplier";

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
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">ERP</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td className="px-4 py-3 font-medium">{store.code}</td>
                    <td className="px-4 py-3">{store.name}</td>
                    <td className="px-4 py-3">
                      <StoreErpSelect id={store.id} erpType={store.erpType} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={store.isActive ? "active" : "inactive"}>
                        {store.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <StoreToggleButton
                        id={store.id}
                        isActive={store.isActive}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
