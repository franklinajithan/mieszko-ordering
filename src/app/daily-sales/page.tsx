import { DailySalesPageView } from "@/components/imports/daily-sales-page";
import { storeRepository } from "@/repositories";

export default async function DailySalesPage() {
  const stores = await storeRepository.list();
  return <DailySalesPageView stores={stores} />;
}
