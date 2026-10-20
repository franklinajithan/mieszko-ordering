"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderSheetFormState } from "@/types/orderSheet";

type Gap = {store_id:number;store_name:string;source_type:"normal_sales"|"rtc"|"wastage";day:string;status:string;reason:string;can_download:boolean;run_id:number|null;configuration_required:boolean};
type Coverage = {rows:Gap[];total:number;pages:number;page:number;unavailable:number;pending:number};
type ApiResponse<T> = {success:boolean;data:T;error?:string};

export function OrderSheetRecovery({form,scanRequest=0}:{form:OrderSheetFormState;scanRequest?:number}) {
 const lastRequest=useRef(scanRequest);
 const [rows,setRows]=useState<Gap[]>([]);
 const [scanning,setScanning]=useState(false);
 const [running,setRunning]=useState(false);
 const [message,setMessage]=useState("");
 const [selected,setSelected]=useState<string[]>([]);
 const [progress,setProgress]=useState({done:0,total:0});
 const [scannedScope,setScannedScope]=useState("");
 const [failures,setFailures]=useState<string[]>([]);
 const scope=JSON.stringify({stores:form.storeIds,periods:form.comparisonPeriods,rtc:form.includeRtc,wastage:form.includeWastage});
 const stale=scope!==scannedScope;
 const key=(r:Gap)=>`${r.store_id}:${r.source_type}:${r.day}`;
 const feeds=["normal_sales",...(form.includeRtc?["rtc"]:[]),...(form.includeWastage?["wastage"]:[])];
 async function scan() {
  if(!form.storeIds.length || !form.comparisonPeriods.length){setMessage("Select stores and comparison dates first.");return;}
  setScanning(true);setMessage("");setRows([]);setSelected([]);setFailures([]);
  try {
   const found=new Map<string,Gap>();
   for(const period of form.comparisonPeriods) {
    let page=1;let pages=1;
    do {
     const params=new URLSearchParams({stores:form.storeIds.join(","),feeds:feeds.join(","),from:period.startDate,to:period.endDate,page:String(page),missingOnly:"true"});
     const response=await fetch(`/api/automation/coverage?${params}`,{cache:"no-store"});
     const body=await response.json() as ApiResponse<Coverage>;
     if(!response.ok || !body.success)throw new Error(body.error || "Coverage scan failed");
     for(const row of body.data.rows)found.set(key(row),row);
     pages=body.data.pages;page++;
    } while(page<=pages);
   }
   const gaps=[...found.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.store_name.localeCompare(b.store_name));
   setRows(gaps);setScannedScope(scope);
   setMessage(gaps.length?`Found ${gaps.length} store/date/feed gaps. Review and approve individual downloads below.`:"No report gaps found in selected comparison periods.");
  } catch(error){setMessage(error instanceof Error?error.message:"Unable to scan missing reports.");}
  finally{setScanning(false);}
 }
 async function queueApproved(){
  const approved=rows.filter(row=>selected.includes(key(row))&&row.can_download);
  if(!approved.length||stale)return;
  if(!window.confirm(`Queue ${approved.length} selected CRM reports for download? This will not replace completed reports.`))return;
  setRunning(true);setProgress({done:0,total:approved.length});setMessage("Submitting approved recovery jobs...");
  const failuresNow:string[]=[];
  const queuedIds:number[]=[];
  for(let i=0;i<approved.length;i++){
   const row=approved[i];
   try{
    const response=await fetch("/api/automation/coverage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({storeId:row.store_id,feed:row.source_type,day:row.day})});
    const body=await response.json() as ApiResponse<{runId:number|null;message:string}>;
    if(!response.ok||!body.success)throw new Error(body.error||"Queue rejected");
    if(body.data?.runId)queuedIds.push(body.data.runId);
   }catch(error){failuresNow.push(`${row.store_name} ${row.day} ${row.source_type}: ${error instanceof Error?error.message:"Request failed"}`);}
   setProgress({done:i+1,total:approved.length});
  }
  setRunning(false);setSelected([]);setFailures(failuresNow);
  setMessage(`Submitted ${approved.length-failuresNow.length} recovery requests; ${failuresNow.length} failed. Job IDs: ${queuedIds.length?queuedIds.join(", "):"none created"}. Open Download Queue for live progress, then scan again to verify imports.`);
 }
 useEffect(()=>{
  if(scanRequest===lastRequest.current)return;
  lastRequest.current=scanRequest;
  void scan();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Trigger only on an explicit Generate action; scan snapshots current form.
 },[scanRequest]);
 const eligible=rows.filter(row=>row.can_download);
 return <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-slate-900" aria-label="Mieszko intelligent data recovery">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h3 className="font-semibold">Mieszko · Intelligent Data Recovery</h3><p className="text-slate-600">Check exact CRM reports before placing orders. Downloads require your approval.</p></div>
   <button type="button" onClick={()=>void scan()} disabled={scanning||running} className="rounded bg-blue-700 px-3 py-2 font-medium text-white disabled:opacity-50">{scanning?"Scanning...":"Scan missing reports"}</button>
  </div>
  {message&&<p role="status" className="mt-3">{message}</p>}
  {stale&&rows.length>0&&<p role="alert">Selections changed. Scan again before approving downloads.</p>}
  {failures.length>0&&<div role="alert" className="mt-2 text-red-700">{failures.map(f=><p key={f}>{f}</p>)}</div>}
  {rows.length>0&&<div className="mt-3">
   <p className="mb-2">{rows.length} gaps · {eligible.length} eligible for CRM download. Missing book stock and supplier prices require separate uploads.</p>
   <div className="max-h-72 overflow-auto rounded border bg-white">
    <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Approve</th><th className="p-2">Store</th><th className="p-2">Report date</th><th className="p-2">Feed</th><th className="p-2">Status</th></tr></thead><tbody>{rows.map(row=><tr key={key(row)} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Approve ${row.store_name} ${row.source_type} ${row.day}`} disabled={!row.can_download||running||stale} checked={selected.includes(key(row))} onChange={e=>setSelected(old=>e.target.checked?[...old,key(row)]:old.filter(x=>x!==key(row)))}/></td><td className="p-2">{row.store_name}</td><td className="p-2">{row.day}</td><td className="p-2">{row.source_type.replaceAll("_"," ")}</td><td className="p-2" title={row.reason}>{row.status}{row.configuration_required?" · CRM setup needed":""}</td></tr>)}</tbody></table>
   </div>
   <div className="mt-3 flex flex-wrap items-center gap-3">
    <button type="button" disabled={running||stale||!eligible.length} onClick={()=>setSelected(eligible.map(key))} className="rounded border px-3 py-2">Select eligible</button>
    <button type="button" disabled={running||stale||!selected.length} onClick={()=>setSelected([])} className="rounded border px-3 py-2">Clear selection</button>
    <button type="button" disabled={running||stale||!selected.length} onClick={()=>void queueApproved()} className="rounded bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-50">Approve & queue {selected.length} reports</button>
    <a href="/book-stock" className="text-blue-700 underline">Book stock upload</a>
    <a href="/supplier-prices" className="text-blue-700 underline">Supplier prices upload</a>
    <a href="/downloads" className="text-blue-700 underline">View live download queue</a>
    <a href="/unmatched-products" className="text-blue-700 underline">Review unmatched products</a>
   </div>
   {running&&<p role="status" className="mt-2">Queue requests: {progress.done}/{progress.total}</p>}
  </div>}
 </section>;
}
