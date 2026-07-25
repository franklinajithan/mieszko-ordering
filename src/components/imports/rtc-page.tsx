import { AppShell } from "@/components/layout/app-shell";
import { RtcImportForm } from "@/components/imports/rtc-import-form";

type Store = { id: number; name: string; code: string; erpType: string };

export function RtcPageView({ stores }: { stores: Store[] }) {
  return (
    <AppShell
      title="RTC (Reduce to Clear)"
      description="Import reduce-to-clear quantities by store and date from Excel."
    >
      <RtcImportForm stores={stores} />
    </AppShell>
  );
}
