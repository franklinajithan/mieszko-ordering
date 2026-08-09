import { SupplierCodesPageView } from "@/components/supplier-codes/supplier-codes-page";
import { listStores } from "@/lib/api/stores";

export default async function SupplierCodesPage() {
  const stores = await listStores();
  if (!stores.success) throw new Error(stores.error);
  return <SupplierCodesPageView stores={stores.data} />;
}
