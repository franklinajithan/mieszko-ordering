import { AppShell } from "@/components/layout/app-shell";
import { OrderWizard } from "@/components/orders/order-wizard";
import {
  productRepository,
  storeRepository,
  supplierRepository,
} from "@/repositories";

export default async function NewOrderPage() {
  const [stores, suppliers, departments] = await Promise.all([
    storeRepository.list(),
    supplierRepository.list(),
    productRepository.getDepartments(),
  ]);

  return (
    <AppShell title="New order">
      <OrderWizard stores={stores} suppliers={suppliers} departments={departments} />
    </AppShell>
  );
}
