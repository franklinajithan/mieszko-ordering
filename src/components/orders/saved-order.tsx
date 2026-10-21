"use client";
import { previewOrderItem } from "@/utils/order-item-edit";
import { SupplierOrderPanel } from "./supplier-order-panel";
import { useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { OrderSheetResultsPanel } from '@/components/order-sheet/order-sheet-results-panel';
import { saveOrderSheetDraft } from '@/lib/api/order-sheet';
import { exportOrder } from '@/lib/api/orders';
import type { OrderSheetResult } from '@/types/orderSheet';

export function SavedOrder({ result, includeRtc, includeWastage, comment: initialComment }: { result: OrderSheetResult; includeRtc: boolean; includeWastage: boolean; comment: string }) {
  const [items, setItems] = useState(result.items);
  const [comment, setComment] = useState(initialComment);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function persistDraft() {
    const saved = await saveOrderSheetDraft({orderId:result.orderId,comment,items:items.map(item => ({orderItemId:item.orderItemId,orderQty:item.orderQty,selected:item.selected}))});
    if (!saved.success) throw new Error(saved.error);
  }
  async function save(andExport = false) {
    setBusy(true); setMessage('');
    try {
      await persistDraft();
      if (andExport) {
        const exported = await exportOrder({orderId:result.orderId});
        if (!exported.success) throw new Error(exported.error);
        const bytes = Uint8Array.from(atob(exported.data.base64), char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
        const link = document.createElement('a'); link.href=url; link.download=exported.data.fileName; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage(andExport ? 'Saved and exported.' : 'Changes saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save'); }
    finally { setBusy(false); }
  }
  return <AppShell title={`Order #${result.orderId}`} description="Review saved calculations, adjust quantities, and export.">
    <div className="space-y-4">
      <label className="block">Order notes<textarea disabled={busy} value={comment} onChange={event=>setComment(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <div className="flex gap-3"><button disabled={busy} onClick={()=>void save()} className="rounded border px-4 py-2">Save changes</button><button disabled={busy} onClick={()=>void save(true)} className="rounded bg-emerald-700 px-4 py-2 text-white">Save and export</button></div>
      {message ? <p role="status">{message}</p> : null}
      <SupplierOrderPanel orderId={result.orderId} beforeGenerate={persistDraft} revision={JSON.stringify(items.map(item=>[item.orderItemId,item.orderQty,item.selected]))} />
      <fieldset className="min-w-0" disabled={busy}>
        <OrderSheetResultsPanel result={result} items={items} includeRtc={includeRtc} includeWastage={includeWastage} showStoreColumn
          onToggleSelected={(id,selected)=>setItems(current=>current.map(item=>item.orderItemId===id?previewOrderItem(item,{selected}):item))}
          onToggleAll={selected=>setItems(current=>current.map(item=>previewOrderItem(item,{selected})))}
          onOrderQtyChange={(id,orderQty)=>setItems(current=>current.map(item=>item.orderItemId===id?previewOrderItem(item,{orderQty}):item))} />
      </fieldset>
    </div>
  </AppShell>;
}
