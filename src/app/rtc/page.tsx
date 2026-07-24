import { AppShell } from "@/components/layout/app-shell";
import { RtcImportForm } from "@/components/imports/rtc-import-form";
import { storeRepository } from "@/repositories";

export default async function RtcPage() {
  const stores = await storeRepository.list();

  return (
    <AppShell
      title="RTC (Reduce to Clear)"
      description="Import reduce-to-clear quantities by store and date from Excel."
    >
      <RtcImportForm stores={stores} />
    </AppShell>
  );
}
