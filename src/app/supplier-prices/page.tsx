import { SupplierPricesPageView } from "@/components/daily-sales/supplier-prices-page";
import { listSuppliers } from "@/lib/api/suppliers";

export default async function SupplierPricesPage() {
  const suppliers = await listSuppliers();
  if (!suppliers.success) throw new Error(suppliers.error);
  return <SupplierPricesPageView suppliers={suppliers.data} />;
}
