"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {useTablePreferences} from "./hooks/use-table-preferences";
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
  const [preferences,setPreferences]=useTablePreferences();
  const {onlySuggested,onlySelected}=preferences;
  const [page,setPage]=useState(1);
  const deferredSearch=useDeferredValue(search);
  const [explainedItemId, setExplainedItemId] = useState<number | null>(null);

  const allSelected = items.length > 0 && items.every((item) => item.selected);
  const storeOptions=useMemo(()=>[...new Map(items.filter(i=>i.storeCode).map(i=>[i.storeCode!,i.storeName??i.storeCode!])).entries()],[items]);
  const storeFilter=storeOptions.some(([code])=>code===preferences.store)?preferences.store:'';
  const supplierFilter=supplierColumns.some(s=>String(s.supplierId)===preferences.supplier)?preferences.supplier:'';

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return items.filter((item) => {
      if(storeFilter && item.storeCode!==storeFilter)return false;
      if(supplierFilter && !item.supplierQuotes.some(q=>String(q.supplierId)===supplierFilter))return false;
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
  }, [items, deferredSearch, onlySuggested, onlySelected,storeFilter,supplierFilter]);

  const currentPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/preferences.pageSize)));
  const visible=filtered.slice((currentPage-1)*preferences.pageSize,currentPage*preferences.pageSize);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label className="text-sm font-medium text-zinc-700">Search Product</label>
          <Input
            value={search}
            onChange={(event) => {setSearch(event.target.value);setPage(1);}}
            aria-label="Search order products"
            placeholder="Item code, barcode, or product name"
            className="mt-1"
          />
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlySuggested}
              onChange={(event) => {setPreferences({onlySuggested:event.target.checked});setPage(1);}}
            />
            Only Suggested Qty &gt; 0
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(event) => {setPreferences({onlySelected:event.target.checked});setPage(1);}}
            />
            Only selected products
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>Store <select aria-label="Order table store" value={storeFilter} onChange={e=>{setPreferences({store:e.target.value});setPage(1);}} className="rounded border p-2"><option value="">All stores</option>{storeOptions.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
        <label>Supplier <select aria-label="Order table supplier" value={supplierFilter} onChange={e=>{setPreferences({supplier:e.target.value});setPage(1);}} className="rounded border p-2"><option value="">All suppliers</option>{supplierColumns.map(s=><option key={s.supplierId} value={s.supplierId}>{s.name}</option>)}</select></label>
        <label>Rows <select aria-label="Order table page size" value={preferences.pageSize} onChange={e=>{setPreferences({pageSize:Number(e.target.value)});setPage(1);}} className="rounded border p-2">{[50,100,200].map(n=><option key={n}>{n}</option>)}</select></label>
        <button onClick={()=>{setPreferences({store:'',supplier:'',onlySuggested:false,onlySelected:false,pageSize:100});setSearch('');setPage(1);}} className="rounded border p-2">Reset table preferences</button>
        <span>{filtered.length} matching products · Page {currentPage}</span><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)} className="rounded border p-2">Previous products</button><button disabled={currentPage*preferences.pageSize>=filtered.length} onClick={()=>setPage(currentPage+1)} className="rounded border p-2">Next products</button>
        <span className="text-xs text-zinc-500">Enter / ↓ next quantity · Shift+Enter / ↑ previous. Select all applies to the whole order.</span>
      </div>
      {explainedItemId !== null ? (() => {
        const item = items.find((row) => row.orderItemId === explainedItemId);
        if (!item) return null;
        return (
          <section role="region" aria-label="Suggested quantity explanation" className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <div><p className="font-semibold text-zinc-900">Why this quantity? — {item.productName}</p><p className="text-xs text-zinc-600">Item {item.itemCode} · {item.storeName ?? item.storeCode ?? "Store"}</p></div>
              <button type="button" onClick={() => setExplainedItemId(null)} className="rounded border bg-white px-3 py-1 text-xs" aria-label="Close explanation">Close ×</button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">Normal sales (selected calculation method)</p><p className="font-semibold">{item.calculatedSoldQty}</p></div>
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">RTC sales (separate feed)</p><p className="font-semibold">{includeRtc ? item.rtcQty : "Excluded"}</p></div>
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">Wastage</p><p className="font-semibold">{includeWastage ? item.wastageQty : "Excluded"}</p></div>
              <div className="rounded-lg bg-white p-3"><p className="text-xs text-zinc-500">Current stock shown</p><p className="font-semibold">{item.currentStock}</p></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <p><span className="text-zinc-600">Calculated normal sold qty:</span> <strong>{item.calculatedSoldQty}</strong></p>
              <p><span className="text-zinc-600">Coverage:</span> <strong>{item.shortfallDays} days</strong></p>
              <p><span className="text-zinc-600">Suggested quantity:</span> <strong>{item.suggestedOrderQty}</strong></p>
            </div>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Book Stock',item.bookStockQty],['Received but not posted',item.receivedNotPostedQty],['Future deliveries in horizon',item.futureDeliveryQty],['Coverage forecast demand',item.coverageDemandQty],['Final manually adjusted quantity',item.orderQty],['Cheapest supplier',item.supplierName],['Net unit price',item.cheapestNetPrice],['Estimated order cost',item.estimatedLineCost]].map(([label,value])=><div key={label}><dt className="text-xs text-zinc-600">{label}</dt><dd className="font-semibold">{value??'Not recorded'}</dd></div>)}</dl>
            <p className="mt-3">Stock anchor: {item.stockAnchorDate??'Not recorded'} · Calculation method: {item.calculationMethod??'Not recorded'}</p>
            <ul className="mt-2 list-inside list-disc">{comparisonPeriods.map((period,index)=><li key={period.periodKey}>{period.startDate} to {period.endDate}: Normal Sales {item.periodSales[index]??'0'} units</li>)}</ul>
            {item.stockStages?.length?<div className="mt-3 overflow-auto"><table className="min-w-full text-xs"><caption className="text-left font-medium">Saved stock movement timeline</caption><thead><tr>{['Stage / date','Stock before','Forecast','Shortage','Delivery added','Stock after'].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{item.stockStages.map((stage,index)=><tr key={index}><td className="p-2">{stage.stage} · {stage.eventDate}</td><td>{stage.stockBefore}</td><td>{stage.forecastSales}</td><td>{stage.shortage}</td><td>{stage.deliveryAdded}</td><td>{stage.stockAfter}</td></tr>)}</tbody></table></div>:null}
            <p className="mt-3 font-medium">Supplier price comparison</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {item.supplierQuotes.length ? item.supplierQuotes.map((quote) => (
                <div key={quote.supplierId} className={`rounded-lg border bg-white px-3 py-2 ${quote.isCheapest ? "border-emerald-400" : "border-zinc-200"}`}>
                  <span className="font-medium">{quote.supplierName} · {quote.supplierProductCode ?? "Unmapped"}</span>
                  <span className="ml-2">{quote.netPrice ?? "Price unavailable"}</span>
                  {quote.caseSize ? <span className="ml-2 text-zinc-500">Case {quote.caseSize}</span> : null}
                  {quote.isCheapest ? <span className="ml-2 text-emerald-700">Cheapest</span> : null}
                </div>
              )) : <p className="text-zinc-600">No supplier quotations available.</p>}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <p>Forecast movement before delivery: <strong>{item.forecastMovementQty ?? "Unavailable"}</strong></p>
              <p>Projected stock at delivery: <strong>{item.projectedStockQty ?? "Unavailable"}</strong></p>
              <p>Expected shortage before delivery: <strong>{item.shortageQty ?? "Unavailable"}</strong></p>
            </div>
            {item.priceWarning ? <p role="status" className="mt-3 text-amber-800">{item.priceWarning}</p> : null}
            <p className="mt-3 text-xs text-zinc-600">Suggested units = coverage demand minus projected stock at delivery, with a minimum of zero, rounded to 2 decimal places. Normal Sales, RTC and Wastage stay separate; enabled movement feeds inform the forecast. Figures and supplier quotes are saved with this order.</p>
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
              <th className="px-3 py-2 text-right">Net Unit Price</th>
              <th className="px-3 py-2 text-right">Line Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={14 + supplierColumns.length + periodLabels.length + dailySalesLabels.length + (showStoreColumn ? 1 : 0)} className="px-3 py-8 text-center text-zinc-500">
                  No products match the current filters.
                </td>
              </tr>
            ) : (
              visible.map((item) => (
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
                      inputMode="decimal"
                      data-order-quantity
                      onKeyDown={event=>{if(!['Enter','ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const inputs=Array.from(event.currentTarget.closest('table')!.querySelectorAll<HTMLInputElement>('input[data-order-quantity]'));const index=inputs.indexOf(event.currentTarget);const next=inputs[index+(event.key==='ArrowUp'||(event.key==='Enter'&&event.shiftKey)?-1:1)];next?.focus();next?.select();}}
                      aria-label={`Order quantity for ${item.productName} at ${item.storeName ?? item.storeCode}`}
                      onChange={(event) =>
                        onOrderQtyChange(item.orderItemId, event.target.value)
                      }
                      className="ml-auto w-24 text-right tabular-nums"
                    />
                    {item.quantityOverridden ? <span className="block text-xs text-blue-600">Manual</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.cheapestNetPrice ? `£${formatDecimal(item.cheapestNetPrice,4)}` : "Needs price"}</td>
                  <td className="px-3 py-2 text-right tabular-nums" aria-live="polite">{item.estimatedLineCost !== null && item.estimatedLineCost !== undefined ? `£${formatDecimal(item.estimatedLineCost,2)}` : "—"}</td>
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
