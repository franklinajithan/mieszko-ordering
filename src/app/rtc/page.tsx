import { RtcPageView } from "@/components/rtc-sales/rtc-page";
import { listStores } from "@/lib/api/stores";

export default async function RtcPage() {
  const stores = await listStores();
  if (!stores.success) {
    throw new Error(stores.error);
  }
  return <RtcPageView stores={stores.data} />;
}
