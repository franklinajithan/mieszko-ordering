"use client";

import { OrderSheetPanel } from "@/components/order-sheet/order-sheet-section";
import { OrderSheetResultsTable } from "@/components/order-sheet/order-sheet-results-table";
import type { OrderSheetItem, OrderSheetResult } from "@/types/orderSheet";

export function OrderSheetResultsPanel({
  result,
  items,
  includeWastage,
  includeRtc,
  showStoreColumn,
  onToggleSelected,
  onToggleAll,
  onOrderQtyChange,
}: {
  result: OrderSheetResult;
  items: OrderSheetItem[];
  includeWastage: boolean;
  includeRtc: boolean;
  showStoreColumn: boolean;
  onToggleSelected: (orderItemId: number, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onOrderQtyChange: (orderItemId: number, orderQty: string) => void;
}) {
  return (
    <OrderSheetPanel className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Products", result.summary.productCount.toLocaleString()],
          ["Products To Order", result.summary.productsToOrder.toLocaleString()],
          ["Total Suggested Qty", result.summary.totalSuggestedQty],
          ["Selected Suppliers", String(result.summary.selectedSupplierCount)],
          ["Shortfall", `${result.summary.shortfallDays} Days`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2"
          >
            <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
            <p className="text-lg font-semibold text-zinc-900">{value}</p>
          </div>
        ))}
      </div>

      <OrderSheetResultsTable
        items={items}
        periodLabels={result.periodLabels}
        dailySalesLabels={result.dailySalesLabels}
        includeWastage={includeWastage}
        includeRtc={includeRtc}
        showStoreColumn={showStoreColumn}
        onToggleSelected={onToggleSelected}
        onToggleAll={onToggleAll}
        onOrderQtyChange={onOrderQtyChange}
      />
    </OrderSheetPanel>
  );
}
