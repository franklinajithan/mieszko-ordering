import { PromoSalesPageView } from "@/components/imports/promo-sales-page";
import { storeRepository } from "@/repositories";

export default async function PromoSalesPage() {
  const stores = await storeRepository.list();
  return <PromoSalesPageView stores={stores} />;
}
