import { AppShell } from "@/components/layout/app-shell";
import { OrderWizard } from "@/components/orders/order-wizard";

import type { DepartmentOption } from "@/types/department";

type Store = { id: number; name: string; code: string; erpType: string };
type Supplier = { id: number; code: string; name: string; isActive: boolean };

export function NewOrderPageView({
  stores,
  suppliers,
  departments,
}: {
  stores: Store[];
  suppliers: Supplier[];
  departments: DepartmentOption[];
}) {
  return (
    <AppShell
      title="New Order"
      description="Step through periods, supplier selection, stock uploads, and calculation."
    >
      <OrderWizard
        stores={stores}
        suppliers={suppliers}
        departments={departments}
      />
    </AppShell>
  );
}
