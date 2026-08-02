import { AppShell } from "@/components/layout/app-shell";
import { RtcImportForm } from "@/components/rtc-sales/rtc-import-form";
import type { Store } from "@/types/store";

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
