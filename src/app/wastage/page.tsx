import { WastagePageView } from "@/components/wastage/wastage-page";
import { listStores } from "@/lib/api/stores";


export default async function WastagePage() {
  const stores = await listStores();
  if (!stores.success) return <div>Error: {stores.error}</div>;
  return <WastagePageView stores={stores.data} />;
}
