import { AppShell } from "@/components/layout/app-shell";
import { SupplierPriceImportForm } from "@/components/daily-sales/supplier-price-import-form";

type Supplier = { id: number; code: string; name: string };

export function SupplierPricesPageView({
  suppliers,
}: {
  suppliers: Supplier[];
}) {
  return (
    <AppShell
      title="Supplier Prices"
      description="Import net-price files and match rows by supplier code."
    >
      <SupplierPriceImportForm suppliers={suppliers} />
    </AppShell>
  );
}
