import { AppShell } from "@/components/layout/app-shell";
import { OrderSheetPage } from "@/components/order-sheet/order-sheet-page";
import { listDepartments } from "@/lib/api/departments";
import { listStores } from "@/lib/api/stores";
import { listSuppliers } from "@/lib/api/suppliers";

export default async function OrderSheetRoutePage() {
  const [stores, suppliers, departments] = await Promise.all([
    listStores(),
    listSuppliers(),
    listDepartments(),
  ]);

  if (!stores.success) throw new Error(stores.error);
  if (!suppliers.success) throw new Error(suppliers.error);
  if (!departments.success) throw new Error(departments.error);

  return (
    <AppShell title="Order Sheet">
      <OrderSheetPage
        stores={stores.data.filter((store) => store.isActive)}
        suppliers={suppliers.data}
        departments={departments.data
          .filter((department) => department.isActive)
          .map((department) => ({
            id: department.id,
            name: department.name,
          }))}
      />
    </AppShell>
  );
}
