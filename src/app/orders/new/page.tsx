import { AppShell } from "@/components/layout/app-shell";
import { OrderWizard } from "@/components/orders/order-wizard";
import {
  departmentRepository,
  storeRepository,
  supplierRepository,
} from "@/repositories";

export default async function NewOrderPage() {
  const [stores, suppliers, departments] = await Promise.all([
    storeRepository.list(),
    supplierRepository.list(),
    departmentRepository.listActiveNames(),
  ]);

  return (
    <AppShell
      title="New Order"
      description="Step through periods, supplier selection, stock uploads, and calculation."
    >
      <OrderWizard stores={stores} suppliers={suppliers} departments={departments} />
    </AppShell>
  );
}
