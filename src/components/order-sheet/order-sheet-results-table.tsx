"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {useGridWindow,ORDER_GRID_ROW_HEIGHT} from "./hooks/use-grid-window";
import {useTablePreferences} from "./hooks/use-table-preferences";
import {ReviewDialog} from "@/components/ui/review-dialog";
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
  const [sort,setSort]=useState("original");
  const [jumpRow,setJumpRow]=useState("");
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

  const sorted=useMemo(()=>{
    if(sort==='original')return filtered;
    return [...filtered].sort((a,b)=>sort==='product'?a.productName.localeCompare(b.productName):sort==='code'?a.itemCode.localeCompare(b.itemCode,undefined,{numeric:true}):parseQty(b.suggestedOrderQty).comparedTo(parseQty(a.suggestedOrderQty)));
  },[filtered,sort]);
  const pageSize=preferences.pageSize===0?Math.max(1,filtered.length):preferences.pageSize;
  const currentPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)));
  const pageRows=sorted.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const {viewport:viewportRef,header:headerRef,onScroll:handleGridScroll,focusQuantity,start:windowStart,end:windowEnd}=useGridWindow(pageRows.length,JSON.stringify([deferredSearch,storeFilter,supplierFilter,onlySuggested,onlySelected,sort,currentPage,pageSize,pageRows.length]));
  const visible=pageRows.slice(windowStart,windowEnd);
  const periodColumns=comparisonPeriods.length?comparisonPeriods:periodLabels.map((label,index)=>({periodKey:`period_${index+1}`,title:label,dateRangeLabel:'',startDate:'',endDate:''}));
  const periodFeedCount=1+Number(includeRtc)+Number(includeWastage);
  const columnCount=15+supplierColumns.length+periodColumns.length*periodFeedCount+dailySalesLabels.length+Number(showStoreColumn);
  return (
    <div className="min-w-0 space-y-3">
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
        <label>Rows <select aria-label="Order table page size" value={preferences.pageSize} onChange={e=>{setPreferences({pageSize:Number(e.target.value)});setPage(1);}} className="rounded border p-2">{[0,50,100,200,500,1000].map(n=><option key={n} value={n}>{n===0?"All rows":n}</option>)}</select></label>
        <button onClick={()=>{setPreferences({store:'',supplier:'',onlySuggested:false,onlySelected:false,pageSize:0});setSearch('');setPage(1);setSort('original');setJumpRow('');}} className="rounded border p-2">Reset table preferences</button>
        <label>Sort <select aria-label="Sort order products" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}} className="rounded border p-2"><option value="original">Original order</option><option value="code">Item code</option><option value="product">Product name</option><option value="suggested">Highest suggested quantity</option></select></label>
        <span>{filtered.length} matching products · {preferences.pageSize===0?"All rows":`Page ${currentPage}`}</span>{preferences.pageSize>0&&<><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)} className="rounded border p-2">Previous products</button><button disabled={currentPage*pageSize>=filtered.length} onClick={()=>setPage(currentPage+1)} className="rounded border p-2">Next products</button></>}
        {preferences.pageSize===0&&<label className="flex items-center gap-2">Go to row <input type="number" min={1} max={filtered.length} aria-label="Go to product row" className="w-24 rounded border p-2" value={jumpRow} onChange={event=>setJumpRow(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();const row=Number(jumpRow);if(Number.isInteger(row)&&row>0&&row<=filtered.length)focusQuantity(row-1);}}} /><button type="button" className="rounded border p-2" onClick={()=>{const row=Number(jumpRow);if(Number.isInteger(row)&&row>0&&row<=filtered.length)focusQuantity(row-1);}}>Go</button></label>}
        <span className="text-xs text-zinc-500">Enter / ↓ next quantity · Shift+Enter / ↑ previous. Select all applies to the whole order.</span>
      </div>
      {explainedItemId !== null ? (() => {
        const item = items.find((row) => row.orderItemId === explainedItemId);
        if (!item) return null;
        return (
          <ReviewDialog open={true} onOpenChange={open=>{if(!open)setExplainedItemId(null);}} title={`Why this quantity? — ${item.productName}`} description={`Item ${item.itemCode} · ${item.storeName??item.storeCode??'Store'}`} closeLabel="Close explanation">
          <section role="region" aria-label="Suggested quantity explanation" className="text-sm">
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
            <div className="mt-3 overflow-auto rounded border"><table className="w-full min-w-[550px] text-left [&_th]:border [&_th]:p-2 [&_td]:border [&_td]:p-2"><caption className="text-left font-medium">Comparison period movement totals</caption><thead><tr>{['Dates','Normal sales','RTC','Wastage'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{comparisonPeriods.map((period,index)=><tr key={period.periodKey}><td>{period.startDate} to {period.endDate}</td><td>{item.periodSales[index]??'Not recorded'}</td><td>{includeRtc?(item.periodRtc?.[index]??'Recalculate to show totals'):'Excluded'}</td><td>{includeWastage?(item.periodWastage?.[index]??'Recalculate to show totals'):'Excluded'}</td></tr>)}</tbody></table></div>
            <p className="mt-2 text-xs text-zinc-600">Each column totals transactions within its inclusive comparison dates. Forecast RTC uses the selected sales method; forecast Wastage uses the average across comparison periods. Gaps between periods are excluded.</p>
            {item.stockStages?.length?<div className="mt-3 overflow-auto"><table className="min-w-full text-xs"><caption className="text-left font-medium">Saved stock movement timeline</caption><thead><tr>{['Stage / date','Stock before','Forecast','Shortage','Delivery added','Stock after'].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{item.stockStages.map((stage,index)=><tr key={index}><td className="p-2">{stage.stage} · {stage.eventDate}</td>{[stage.stockBefore,stage.forecastSales,stage.shortage,stage.deliveryAdded,stage.stockAfter].map((value,index)=><td key={index} className="p-2 text-right tabular-nums">{formatDecimal(value,4)}</td>)}</tr>)}</tbody></table></div>:null}
            <p className="mt-3 font-medium">Supplier price comparison</p>
            <div className="mt-2 overflow-auto rounded border"><table className="w-full min-w-[650px] border-collapse text-left text-sm [&_th]:border [&_th]:p-2 [&_td]:border [&_td]:p-2"><thead className="bg-zinc-50"><tr>{['Supplier','Supplier code','Net unit price','Case size','Status'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{item.supplierQuotes.map(quote=><tr key={quote.supplierId} className={quote.isCheapest?'bg-emerald-50':''}><td>{quote.supplierName}</td><td>{quote.supplierProductCode??'Unmapped'}</td><td className="text-right tabular-nums">{quote.netPrice?`£${formatDecimal(quote.netPrice,4)}`:'Unavailable'}</td><td>{quote.caseSize??'Not supplied'}</td><td>{quote.isCheapest?'Cheapest valid price':quote.failureReason??quote.priceValidationStatus}</td></tr>)}{!item.supplierQuotes.length&&<tr><td colSpan={5}>No supplier quotations available.</td></tr>}</tbody></table></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <p>Forecast movement before delivery: <strong>{item.forecastMovementQty ?? "Unavailable"}</strong></p>
              <p>Projected stock at delivery: <strong>{item.projectedStockQty ?? "Unavailable"}</strong></p>
              <p>Expected shortage before delivery: <strong>{item.shortageQty ?? "Unavailable"}</strong></p>
            </div>
            {item.priceWarning ? <p role="status" className="mt-3 text-amber-800">{item.priceWarning}</p> : null}
            <p className="mt-3 text-xs text-zinc-600">Suggested units = coverage demand minus projected stock at delivery, with a minimum of zero, rounded to 2 decimal places. Normal Sales, RTC and Wastage stay separate; enabled movement feeds inform the forecast. Figures and supplier quotes are saved with this order.</p>
          </section>
          </ReviewDialog>
        );
      })() : null}

      <p className="text-xs text-zinc-500">Scroll the grid horizontally for supplier prices and quantities. Select the suggested quantity for its explanation.</p>
      <div ref={viewportRef} onScroll={handleGridScroll} className="max-h-[65vh] overflow-auto overscroll-contain rounded-xl border border-zinc-300" role="region" aria-label="Order product grid" tabIndex={0}>
        <table aria-label="Order products" aria-rowcount={filtered.length+1} className="w-max min-w-full border-separate border-spacing-0 text-left text-sm [&_th]:border-b [&_th]:border-r [&_th]:border-zinc-200 [&_td]:border-b [&_td]:border-r [&_td]:border-zinc-200">
          <colgroup><col style={{width:56}} /><col style={{width:44}} /><col style={{width:112}} /><col style={{width:280}} />{showStoreColumn&&<col style={{width:130}} />}<col style={{width:170}} />{supplierColumns.map(supplier=><col key={supplier.supplierId} style={{width:140}} />)}<col style={{width:130}} /><col style={{width:120}} />{periodColumns.map((_,index)=><col key={`sales-${index}`} style={{width:150}} />)}{dailySalesLabels.map((_,index)=><col key={`day-${index}`} style={{width:110}} />)}{Array.from({length:periodColumns.length*(periodFeedCount-1)},(_,index)=><col key={`movement-${index}`} style={{width:150}} />)}{Array.from({length:8},(_,index)=><col key={`quantity-${index}`} style={{width:130}} />)}</colgroup>
          <thead ref={headerRef} className="sticky top-0 z-20 bg-zinc-100 text-xs font-semibold text-zinc-600 [&_th]:min-w-28">
            <tr className="h-28">
              <th scope="col" className="sticky left-0 z-30 !min-w-14 bg-emerald-100 px-2 py-3 text-right">Row</th>
              <th scope="col" className="sticky left-14 z-30 !min-w-11 bg-zinc-100 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => onToggleAll(event.target.checked)}
                  aria-label="Select all products"
                />
              </th>
              <th scope="col" className="sticky left-[100px] z-30 min-w-28 bg-zinc-100 px-3 py-3">Item Code</th>
              <th scope="col" className="min-w-[280px] bg-zinc-100 px-3 py-3 lg:sticky lg:left-[212px] lg:z-30">Product</th>
              {showStoreColumn ? <th className="px-3 py-2">Store</th> : null}
              <th className="px-3 py-2">Barcode</th>
              {supplierColumns.map((supplier) => (
                <th key={supplier.supplierId} className={`px-3 py-2 ${supplierColour(supplier.code)}`}>
                  {supplier.code}
                </th>
              ))}
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2 text-right">Current Stock</th>
              {periodColumns.map(column=><th key={`${column.periodKey}-Normal sales`} scope="col" className="px-3 py-2 text-right align-bottom bg-blue-50"><div className="font-semibold">{column.title} · Normal sales</div><div className="mt-1 text-[11px] font-normal text-zinc-600">{column.dateRangeLabel}</div><div className="mt-1 text-[10px] font-normal">Period total (units)</div></th>)}
              {dailySalesLabels.map((label, index) => (
                <th key={`day-${index}`} className="px-3 py-2 text-right whitespace-nowrap bg-blue-50/80">
                  {label}
                </th>
              ))}
              {includeWastage&&periodColumns.map(column=><th key={`${column.periodKey}-Wastage`} scope="col" className="px-3 py-2 text-right align-bottom bg-amber-50"><div className="font-semibold">{column.title} · Wastage</div><div className="mt-1 text-[11px] font-normal text-zinc-600">{column.dateRangeLabel}</div><div className="mt-1 text-[10px] font-normal">Period total (units)</div></th>)}
              {includeRtc&&periodColumns.map(column=><th key={`${column.periodKey}-RTC`} scope="col" className="px-3 py-2 text-right align-bottom bg-violet-50"><div className="font-semibold">{column.title} · RTC</div><div className="mt-1 text-[11px] font-normal text-zinc-600">{column.dateRangeLabel}</div><div className="mt-1 text-[10px] font-normal">Period total (units)</div></th>)}
              <th className="px-3 py-2 text-right">Calculated Sold Qty</th>
              <th className="px-3 py-2 text-right">Forecast Wastage (average)</th>
              <th className="px-3 py-2 text-right">Forecast RTC</th>
              <th className="px-3 py-2 text-right">Shortfall Days</th>
              <th className="px-3 py-2 text-right">Suggested Order Qty</th>
              <th className="px-3 py-2 text-right">Order Qty</th>
              <th className="px-3 py-2 text-right">Net Unit Price</th>
              <th className="px-3 py-2 text-right">Line Cost</th>
            </tr>
          </thead>
          <tbody className="[&>tr:nth-child(even)]:bg-zinc-50/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-3 py-8 text-center text-zinc-500">
                  No products match the current filters.
                </td>
              </tr>
            ) : (
              <>
              {windowStart>0&&<tr aria-hidden="true"><td colSpan={columnCount} className="!border-0 !p-0" style={{height:windowStart*ORDER_GRID_ROW_HEIGHT}} /></tr>}
              {visible.map((item,windowIndex) => (

                <tr key={item.orderItemId} aria-rowindex={(currentPage-1)*pageSize+windowStart+windowIndex+2} style={{height:ORDER_GRID_ROW_HEIGHT}} className="hover:bg-blue-50/60 focus-within:bg-blue-50/60">
                  <td className="sticky left-0 z-10 bg-emerald-50 px-2 py-2 text-right text-xs tabular-nums text-zinc-600">{(currentPage-1)*pageSize+windowStart+windowIndex+1}</td>
                  <td className="sticky left-14 z-10 bg-white px-3 py-2">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={(event) =>
                        onToggleSelected(item.orderItemId, event.target.checked)
                      }
                    />
                  </td>
                  <td className="sticky left-[100px] z-10 min-w-28 max-w-28 break-all bg-white px-3 py-2 font-medium" title={item.itemCode}><span className="block max-w-24 truncate">{item.itemCode}</span></td>
                  <td className="min-w-[280px] max-w-[280px] whitespace-normal bg-white px-3 py-2 lg:sticky lg:left-[212px] lg:z-10" title={item.productName}><div className="line-clamp-3">{item.productName}</div></td>
                  {showStoreColumn ? (
                    <td className="px-3 py-2" title={item.storeName ?? undefined}>
                      {item.storeCode ?? "—"}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{item.barcode ?? "—"}</td>
                  {supplierColumns.map((supplier) => {
                    const quote = item.supplierQuotes.find(
                      (entry) => entry.supplierId === supplier.supplierId,
                    );
                    return (
                      <td
                        key={`${item.orderItemId}-${supplier.supplierId}`}
                        className={`px-3 py-2 ${quote?.isCheapest ? "bg-emerald-50/80" : ""}`}
                      >
                        <SupplierQuoteCell quote={quote} colour={supplierColour(supplier.code)} />
                      </td>
                    );
                  })}
                  <td className="max-w-32 px-3 py-2" title={item.departmentName??undefined}><div className="line-clamp-3">{item.departmentName ?? "—"}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.currentStock}</td>
                  {periodColumns.map((column,index)=><td key={`${column.periodKey}-sales`} className="whitespace-nowrap bg-blue-50/30 px-3 py-2 text-right tabular-nums">{formatDecimal(item.periodSales[index]??'0',2)}</td>)}
                  {item.dailySales.map((sale, index) => (
                    <td
                      key={`${item.orderItemId}-day-${index}`}
                      className="px-3 py-2 text-right tabular-nums bg-blue-50/40"
                    >
                      {formatDecimal(parseDbDecimal(sale), 2)}
                    </td>
                  ))}
                  {includeWastage&&periodColumns.map((column,index)=><td key={`${column.periodKey}-wastage`} className="whitespace-nowrap bg-amber-50/30 px-3 py-2 text-right tabular-nums" title={`Wastage: ${column.startDate} to ${column.endDate}`}>{item.periodWastage?.[index]!=null?formatDecimal(item.periodWastage[index],4):'Recalculate'}</td>)}
                  {includeRtc&&periodColumns.map((column,index)=><td key={`${column.periodKey}-rtc`} className="whitespace-nowrap bg-violet-50/30 px-3 py-2 text-right tabular-nums" title={`RTC: ${column.startDate} to ${column.endDate}`}>{item.periodRtc?.[index]!=null?formatDecimal(item.periodRtc[index],4):'Recalculate'}</td>)}
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
                      aria-haspopup="dialog"
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
                      data-order-index={windowStart+windowIndex}
                      onKeyDown={event=>{if(!['Enter','ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();focusQuantity(windowStart+windowIndex+(event.key==='ArrowUp'||(event.key==='Enter'&&event.shiftKey)?-1:1));}}
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
              ))}
              {windowEnd<pageRows.length&&<tr aria-hidden="true"><td colSpan={columnCount} className="!border-0 !p-0" style={{height:(pageRows.length-windowEnd)*ORDER_GRID_ROW_HEIGHT}} /></tr>}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function supplierColour(code:string){
 if(/^MM$/i.test(code))return 'text-blue-800 bg-blue-50/40';
 if(/^SP$/i.test(code))return 'text-violet-800 bg-violet-50/40';
 if(/^WAB(?:AR)?$/i.test(code))return 'text-amber-900 bg-amber-50/40';
 return 'text-zinc-800';
}
function SupplierQuoteCell({quote,colour}:{quote?:OrderItemSupplierQuote;colour:string}){
 if(!quote?.supplierProductCode&&!quote?.netPrice&&!quote?.caseSize)return <span className="text-zinc-400">—</span>;
 return <div className="space-y-0.5"><p className={`whitespace-nowrap text-base font-semibold tabular-nums ${colour}`}>{quote.netPrice?`£${formatDecimal(quote.netPrice,4)}`:'Needs price'}</p><p className="max-w-32 truncate font-mono text-xs text-zinc-600" title={quote.supplierProductCode??undefined}>{quote.supplierProductCode??'Unmapped'}</p>{quote.caseSize&&<p className="text-[10px] text-zinc-500">Case {quote.caseSize}</p>}</div>;
}
