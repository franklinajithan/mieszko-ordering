import Link from "next/link";
import { History } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { storeRepository } from "@/repositories/stores";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import { AdmWorkbookImport } from "./adm-workbook-import";

export const dynamic = "force-dynamic";

export default async function AdmOrderPage() {
  const stores = await storeRepository.list();
  const shops = stores.filter(({ isActive, erpType }) => isActive && erpType === "msp")
    .map(({ id, name }) => ({ id, name }));
  const today = todayIso();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const deliveryDate = addDaysIso(today, Math.min((7 - weekday) % 7, (10 - weekday) % 7));

  return (
    <AppShell title="ADM Order">
      <div className="mb-4 flex justify-end">
        <Link href="/adm-order/history" className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50">
          <History size={16} aria-hidden /> ADM Order History
        </Link>
      </div>
      <AdmWorkbookImport shops={shops} initialDate={deliveryDate} />
    </AppShell>
  );
}
