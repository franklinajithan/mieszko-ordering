"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type {
  OrderItemSupplierQuote,
  OrderSheetComparisonPeriodColumn,
  OrderSheetItem,
  OrderSheetSupplierColumn,
} from "@/types/orderSheet";
import { formatDecimal, parseDbDecimal } from "@/utils/decimal";
import { parseQty } from "@/utils/orderSheetCalculations";

export function OrderSheetResultsTable({
  items,
  periodLabels,
  comparisonPeriods = [],
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
  comparisonPeriods?: OrderSheetComparisonPeriodColumn[];
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
  const [explainedItemId, setExplainedItemId] = useState<number | null>(null);

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

      {explainedItemId !== null ? (() => {
        const item = items.find((row) => row.orderItemId === explainedItemId);
        if (!item) return null;
        const normalSales = item.periodSales.reduce((sum, value) => sum.plus(parseQty(value)), parseQty("0"));
        const periodsCount = item.periodSales.length || 1;
        const rtc = includeRtc ? parseQty(item.rtcQty) : parseQty("0");
        const wastage = includeWastage ? parseQty(item.wastageQty) : parseQty("0");
        return (
          <section role="region" aria-label="Suggested quantity explanation" className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <div><p className="font-semibold text-zinc-900">Why this quantity? — {item.productName}</p><p className="text-xs text-zinc-600">Item {item.itemCode} · {item.storeName ?? item.storeCode ?? "Store"}</p></div>
              <button type="button" onClick={() => setExplainedItemId(null)} className="rounded border bg-white px-3 py-1 text-xs" aria-label="Close explanation">Close ×</button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">Normal sales (average per comparison period)</p><p className="font-semibold">{normalSales.div(periodsCount).toFixed(2)}</p></div>
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">RTC sales (separate feed)</p><p className="font-semibold">{includeRtc ? item.rtcQty : "Excluded"}</p></div>
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">Wastage</p><p className="font-semibold">{includeWastage ? item.wastageQty : "Excluded"}</p></div>
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">Current stock shown</p><p className="font-semibold">{item.currentStock}</p></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <p><span className="text-zinc-600">Calculated normal sold qty:</span> <strong>{item.calculatedSoldQty}</strong></p>
              <p><span className="text-zinc-600">Coverage:</span> <strong>{item.shortfallDays} days</strong></p>
              <p><span className="text-zinc-600">Suggested quantity:</span> <strong>{item.suggestedOrderQty}</strong></p>
            </div>
            <p className="mt-3 font-medium">Supplier price comparison</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {item.supplierQuotes.length ? item.supplierQuotes.map((quote) => (
                <div key={quote.supplierId} className={`rounded-lg border bg-white px-3 py-2 ${quote.isCheapest ? "border-emerald-400" : "border-zinc-200"}`}>
                  <span className="font-medium">{quote.supplierProductCode ?? "Unmapped"}</span>
                  <span className="ml-2">{quote.netPrice ?? "Price unavailable"}</span>
                  {quote.caseSize ? <span className="ml-2 text-zinc-500">Case {quote.caseSize}</span> : null}
                  {quote.isCheapest ? <span className="ml-2 text-emerald-700">Cheapest</span> : null}
                </div>
              )) : <p className="text-zinc-600">No supplier quotations available.</p>}
            </div>
            <p className="mt-3 text-xs text-zinc-600">RTC is independent of normal sales. Values reflect the generated order; detailed stock-event forecasting and wastage adjustments will be expanded in the next iteration. Prices may be stale; verify supplier quotes before purchasing.</p>
          </section>
        );
      })() : null}

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
              {(comparisonPeriods.length
                ? comparisonPeriods
                : periodLabels.map((label, index) => ({
                    periodKey: `period_${index + 1}`,
                    title: label,
                    dateRangeLabel: "",
                    startDate: "",
                    endDate: "",
                  }))
              ).map((column) => (
                <th key={column.periodKey} className="px-3 py-2 text-right align-bottom">
                  <div className="font-semibold normal-case">{column.title}</div>
                  {column.dateRangeLabel ? (
                    <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-zinc-500">
                      {column.dateRangeLabel}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-zinc-600">
                    Total sales
                  </div>
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
                      {formatDecimal(parseDbDecimal(sale), 2)}
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
                    <button
                      type="button"
                      title="Explain suggested quantity"
                      aria-label={`Explain suggested quantity for ${item.productName}`}
                      aria-expanded={explainedItemId === item.orderItemId}
                      onClick={() => setExplainedItemId(explainedItemId === item.orderItemId ? null : item.orderItemId)}
                      className="rounded px-2 py-1 underline decoration-dotted underline-offset-4 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      {item.suggestedOrderQty} <span aria-hidden="true">ⓘ</span>
                    </button>
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
