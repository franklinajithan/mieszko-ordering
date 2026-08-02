import { SupplierPricesPageView } from "@/components/daily-sales/supplier-prices-page";
import { supplierRepository } from "@/repositories";

export default async function SupplierPricesPage() {
  const suppliers = await supplierRepository.list();
  return <SupplierPricesPageView suppliers={suppliers} />;
}
