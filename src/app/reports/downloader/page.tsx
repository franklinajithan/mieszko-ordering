import { AppShell } from "@/components/layout/app-shell";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import { ReportDownloader } from "./report-downloader";

export default function Page() {
  const today = todayIso();
  return (
    <AppShell title="Report Downloader" description="Choose stores, reports and date ranges, then download the completed Excel files by store.">
      <ReportDownloader today={today} yesterday={addDaysIso(today, -1)} />
    </AppShell>
  );
}
