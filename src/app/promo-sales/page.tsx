import { PromoSalesPageView } from "@/components/daily-sales/promo-sales-page";
import { listStores } from "@/lib/api/stores";

export default async function PromoSalesPage() {
  const stores = await listStores();
  if (!stores.success) throw new Error(stores.error);
  return <PromoSalesPageView stores={stores.data} />;
}
