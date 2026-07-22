import { AppShell } from "@/components/layout/app-shell";
import { StoreForm } from "@/components/stores/store-form";
import { StoreToggleButton, SupplierToggleButton } from "@/components/stores/store-actions";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { Badge } from "@/components/ui/badge";
import { storeRepository, supplierRepository } from "@/repositories";

export default async function StoresPage() {
  const [stores, suppliers] = await Promise.all([
    storeRepository.list(),
    supplierRepository.list(),
  ]);

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
                      <Badge status={store.isActive ? "active" : "inactive"}>
                        {store.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <StoreToggleButton id={store.id} isActive={store.isActive} />
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
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Tie priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td className="px-4 py-3 font-medium">{supplier.code}</td>
                    <td className="px-4 py-3">{supplier.name}</td>
                    <td className="px-4 py-3">{supplier.priceTiePriority}</td>
                    <td className="px-4 py-3">
                      <Badge status={supplier.isActive ? "active" : "inactive"}>
                        {supplier.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <SupplierToggleButton id={supplier.id} isActive={supplier.isActive} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
