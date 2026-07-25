import { StoresPageView } from "@/components/stores/stores-page";
import { storeRepository, supplierRepository } from "@/repositories";

export default async function StoresPage() {
  const [stores, suppliers] = await Promise.all([
    storeRepository.list(),
    supplierRepository.list(),
  ]);

  return <StoresPageView stores={stores} suppliers={suppliers} />;
}
