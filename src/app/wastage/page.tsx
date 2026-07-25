import { WastagePageView } from "@/components/imports/wastage-page";
import { storeRepository } from "@/repositories";

export default async function WastagePage() {
  const stores = await storeRepository.list();
  return <WastagePageView stores={stores} />;
}
