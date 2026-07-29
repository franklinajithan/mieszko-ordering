import { DailySalesPageView } from "@/components/imports/daily-sales-page";
import { listStores } from "@/lib/api/stores";

export default async function DailySalesPage() {
  const stores = await listStores();
  return <DailySalesPageView stores={stores.success ? stores.data : []} />;
}
