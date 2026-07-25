import { NewOrderPageView } from "@/components/orders/new-order-page";
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
    <NewOrderPageView
      stores={stores}
      suppliers={suppliers}
      departments={departments}
    />
  );
}
