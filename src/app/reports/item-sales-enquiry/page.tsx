import { AppShell } from "@/components/layout/app-shell";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import { ItemSalesEnquiry } from "./item-sales-enquiry";

export const dynamic = "force-dynamic";

export default function ItemSalesEnquiryPage() {
  const today = todayIso();
  return (
    <AppShell title="Item Sales Enquiry (Report 6)" description="Download one Excel workbook per store and date from the CRM.">
      <ItemSalesEnquiry today={today} initialDate={addDaysIso(today, -1)} />
    </AppShell>
  );
}
