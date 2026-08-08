import { NewOrderPageView } from "@/components/orders/new-order-page";
import { listDepartments } from "@/lib/api/departments";
import { listStores } from "@/lib/api/stores";
import { listSuppliers } from "@/lib/api/suppliers";

export default async function NewOrderPage() {
  const [stores, suppliers, departments] = await Promise.all([
    listStores(),
    listSuppliers(),
    listDepartments(),
  ]);

  if (!stores.success) throw new Error(stores.error);
  if (!suppliers.success) throw new Error(suppliers.error);
  if (!departments.success) throw new Error(departments.error);

  return (
    <NewOrderPageView
      stores={stores.data}
      suppliers={suppliers.data}
      departments={departments.data
        .filter((department) => department.isActive)
        .map((department) => ({
          id: department.id,
          name: department.name,
        }))}
    />
  );
}
