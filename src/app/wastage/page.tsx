import { WastagePageView } from "@/components/daily-sales/wastage-page";
import { storeRepository } from "@/repositories";

export default async function WastagePage() {
  const stores = await storeRepository.list();
  return <WastagePageView stores={stores} />;
}
