import { AppShell } from "@/components/layout/app-shell";
import { CrmAutomation } from "@/components/operations/crm-automation";

export default function AutomationPage() {
  return <AppShell title="CRM Downloads" description="Store URLs, nightly eligibility and daily report requests."><CrmAutomation /></AppShell>;
}
