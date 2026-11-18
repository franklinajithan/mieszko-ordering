import { AppShell } from "@/components/layout/app-shell";
import { TillReceivePanel } from "@/components/scheduled-activity/till-receive-panel";
export default function ScheduledActivityPage() {
  return <AppShell title="Scheduled Activity" description="Store automation and execution history"><TillReceivePanel /></AppShell>;
}
