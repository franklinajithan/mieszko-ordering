import { AppShell } from "@/components/layout/app-shell";
import { ReportDownloader } from "./report-downloader";

export default function Page() {
  return (
    <AppShell title="Report Downloader" description="Run your Excel control files and download the completed reports by store.">
      <ReportDownloader />
    </AppShell>
  );
}
