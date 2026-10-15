"use client";
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/client';

type SupplierDraft={id:number;storeName:string;supplierName:string;deliveryDate:string;totalNetCost:string;lines:unknown[];stale:boolean};
export function SupplierOrderPanel({orderId, beforeGenerate, revision=""}:{orderId:number;beforeGenerate?:()=>Promise<void>;revision?:string}) {
  const [drafts,setDrafts]=useState<SupplierDraft[]>([]);
  const [generatedRevision,setGeneratedRevision]=useState(revision);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let cancelled=false;
    void apiRequest<SupplierDraft[]>(`/orders/${orderId}/supplier-orders`).then(response=>{
      if (!cancelled) { if (response.success) setDrafts(response.data); else setMessage(response.error); }
    });
    return ()=>{cancelled=true;};
  },[orderId,revision]);
  async function generate() {
    setBusy(true);setMessage('');
    try {
      await beforeGenerate?.();
      const response=await apiRequest<SupplierDraft[]>(`/orders/${orderId}/supplier-orders`,{method:'POST'});
      if (!response.success) throw new Error(response.error);
      setDrafts(response.data);setGeneratedRevision(revision);setMessage('Supplier orders generated. Download each store/supplier file below.');
    } catch(error) {setMessage(error instanceof Error?error.message:'Unable to generate supplier orders');}
    finally {setBusy(false);}
  }
  async function download(id:number) {
    setBusy(true);setMessage('');
    try {
      const response=await apiRequest<{base64:string;fileName:string}>(`/orders/${orderId}/supplier-orders/${id}/export`,{method:'POST'});
      if (!response.success) throw new Error(response.error);
      const bytes=Uint8Array.from(atob(response.data.base64),c=>c.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link=document.createElement('a');link.href=url;link.download=response.data.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) {setMessage(error instanceof Error?error.message:'Export failed');}
    finally {setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Supplier orders">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Supplier orders</h2><p className="text-sm text-zinc-500">Creates one order per store and chosen supplier at the lowest valid unit price.</p></div><button type="button" disabled={busy} onClick={()=>void generate()} className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy?'Working…':'Generate supplier orders'}</button></div>
    {message?<p role="status" className="text-sm">{message}</p>:null}
    {drafts.length?<div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Store','Supplier','Delivery','Lines','Net total','Excel'].map(label=><th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{drafts.map(draft=><tr key={draft.id} className="border-t"><td className="p-2">{draft.storeName}</td><td className="p-2">{draft.supplierName}</td><td className="p-2">{draft.deliveryDate}</td><td className="p-2">{draft.lines.length}</td><td className="p-2">£{Number(draft.totalNetCost).toFixed(2)}</td><td className="p-2">{draft.stale || revision!==generatedRevision?<span className="text-amber-700">Regenerate after edits</span>:<button disabled={busy} className="text-blue-700 underline" onClick={()=>void download(draft.id)}>Download</button>}</td></tr>)}</tbody></table></div>:<p className="text-sm text-zinc-500">No supplier orders generated for this sheet.</p>}
  </section>;
}
