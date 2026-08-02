import { DailySalesPageView } from "@/components/daily-sales/daily-sales-page";
import { listStores } from "@/lib/api/stores";

export default async function DailySalesPage() {
  const stores = await listStores();
  return <DailySalesPageView stores={stores.success ? stores.data : []} />;
}
