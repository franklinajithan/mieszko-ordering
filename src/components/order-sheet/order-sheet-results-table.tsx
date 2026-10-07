"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { OrderItemSupplierQuote, OrderSheetItem, OrderSheetSupplierColumn } from "@/types/orderSheet";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import { parseQty } from "@/utils/orderSheetCalculations";

export function OrderSheetResultsTable({
  items,
  periodLabels,
  dailySalesLabels = [],
  supplierColumns = [],
  includeWastage,
  includeRtc,
  showStoreColumn = false,
  onToggleSelected,
  onToggleAll,
  onOrderQtyChange,
}: {
  items: OrderSheetItem[];
  periodLabels: string[];
  dailySalesLabels?: string[];
  supplierColumns?: OrderSheetSupplierColumn[];
  includeWastage: boolean;
  includeRtc: boolean;
  showStoreColumn?: boolean;
  onToggleSelected: (orderItemId: number, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onOrderQtyChange: (orderItemId: number, orderQty: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [onlySuggested, setOnlySuggested] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);

  const allSelected = items.length > 0 && items.every((item) => item.selected);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (onlySuggested && !parseQty(item.suggestedOrderQty).gt(0)) return false;
      if (onlySelected && !item.selected) return false;
      if (!q) return true;
      return (
        item.itemCode.toLowerCase().includes(q) ||
        (item.barcode ?? "").toLowerCase().includes(q) ||
        item.productName.toLowerCase().includes(q) ||
        item.supplierQuotes.some((quote) =>
          (quote.supplierProductCode ?? "").toLowerCase().includes(q),
        )
      );
    });
  }, [items, search, onlySuggested, onlySelected]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label className="text-sm font-medium text-zinc-700">Search Product</label>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Item code, barcode, or product name"
            className="mt-1"
          />
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlySuggested}
              onChange={(event) => setOnlySuggested(event.target.checked)}
            />
            Only Suggested Qty &gt; 0
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(event) => setOnlySelected(event.target.checked)}
            />
            Only selected products
          </label>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-zinc-200">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-600">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => onToggleAll(event.target.checked)}
                  aria-label="Select all products"
                />
              </th>
              <th className="px-3 py-2">Item Code</th>
              {showStoreColumn ? <th className="px-3 py-2">Store</th> : null}
              <th className="px-3 py-2">Barcode</th>
              <th className="px-3 py-2">Product</th>
              {supplierColumns.map((supplier) => (
                <th key={supplier.supplierId} className="px-3 py-2">
                  {supplier.code}
                </th>
              ))}
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2 text-right">Current Stock</th>
              {periodLabels.map((label) => (
                <th key={label} className="px-3 py-2 text-right">
                  {label}
                </th>
              ))}
              {dailySalesLabels.map((label, index) => (
                <th key={`day-${index}`} className="px-3 py-2 text-right whitespace-nowrap bg-blue-50/80">
                  {label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Calculated Sold Qty</th>
              <th className="px-3 py-2 text-right">Wastage</th>
              <th className="px-3 py-2 text-right">RTC</th>
              <th className="px-3 py-2 text-right">Shortfall Days</th>
              <th className="px-3 py-2 text-right">Suggested Order Qty</th>
              <th className="px-3 py-2 text-right">Order Qty</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12 + supplierColumns.length + periodLabels.length + dailySalesLabels.length + (showStoreColumn ? 1 : 0)} className="px-3 py-8 text-center text-zinc-500">
                  No products match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.orderItemId} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={(event) =>
                        onToggleSelected(item.orderItemId, event.target.checked)
                      }
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{item.itemCode}</td>
                  {showStoreColumn ? (
                    <td className="px-3 py-2" title={item.storeName ?? undefined}>
                      {item.storeCode ?? "—"}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-zinc-600">{item.barcode ?? "—"}</td>
                  <td className="px-3 py-2">{item.productName}</td>
                  {supplierColumns.map((supplier) => {
                    const quote = item.supplierQuotes.find(
                      (entry) => entry.supplierId === supplier.supplierId,
                    );
                    return (
                      <td
                        key={`${item.orderItemId}-${supplier.supplierId}`}
                        className={`px-3 py-2 ${quote?.isCheapest ? "bg-emerald-50/80" : ""}`}
                      >
                        <SupplierQuoteCell quote={quote} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">{item.departmentName ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.currentStock}</td>
                  {item.periodSales.map((sale, index) => (
                    <td key={`${item.orderItemId}-${index}`} className="px-3 py-2 text-right tabular-nums">
                      {sale}
                    </td>
                  ))}
                  {item.dailySales.map((sale, index) => (
                    <td
                      key={`${item.orderItemId}-day-${index}`}
                      className="px-3 py-2 text-right tabular-nums bg-blue-50/40"
                    >
                      {formatDecimal(parseDbDecimal(sale), 2)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{item.calculatedSoldQty}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${includeWastage ? "" : "text-zinc-400"}`}
                  >
                    {includeWastage ? item.wastageQty : "0"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${includeRtc ? "" : "text-zinc-400"}`}
                  >
                    {includeRtc ? item.rtcQty : "0"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.shortfallDays}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-blue-700">
                    {item.suggestedOrderQty}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      value={item.orderQty}
                      onChange={(event) =>
                        onOrderQtyChange(item.orderItemId, event.target.value)
                      }
                      className="ml-auto w-24 text-right tabular-nums"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplierQuoteCell({ quote }: { quote?: OrderItemSupplierQuote }) {
  if (!quote?.supplierProductCode && !quote?.netPrice && !quote?.caseSize) {
    return <span className="text-zinc-400">—</span>;
  }
  return (
    <div className="space-y-0.5">
      <p className="font-medium text-zinc-900">{quote.supplierProductCode ?? "—"}</p>
      {quote.netPrice || quote.caseSize ? (
        <p className="text-xs text-zinc-500">
          {[quote.netPrice, quote.caseSize].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
