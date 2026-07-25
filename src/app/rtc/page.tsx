import { RtcPageView } from "@/components/imports/rtc-page";
import { storeRepository } from "@/repositories";

export default async function RtcPage() {
  const stores = await storeRepository.list();
  return <RtcPageView stores={stores} />;
}
