import { AppShell } from "@/components/layout/app-shell";
import { SupplierPriceImportForm } from "@/components/imports/supplier-price-import-form";
import { supplierRepository } from "@/repositories";

export default async function SupplierPricesPage() {
  const suppliers = await supplierRepository.list();
  return (
    <AppShell title="Supplier price import">
      <SupplierPriceImportForm suppliers={suppliers} />
    </AppShell>
  );
}
