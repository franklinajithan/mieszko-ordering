import { AppShell } from "@/components/layout/app-shell";
import { storeRepository } from "@/repositories/stores";
import { addDaysIso, todayIso } from "@/utils/order-sheet-form";
import { AdmOrderForm } from "./adm-order-form";

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
      <AdmOrderForm shops={shops} initialDate={deliveryDate} />
    </AppShell>
  );
}
