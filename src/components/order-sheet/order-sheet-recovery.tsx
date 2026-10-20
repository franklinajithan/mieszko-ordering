"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmAlertDialog } from "@/components/ui/confirm-alert-dialog";
import type { OrderSheetFormState } from "@/types/orderSheet";

type Gap = {store_id:number;store_name:string;source_type:"normal_sales"|"rtc"|"wastage";day:string;status:string;reason:string;can_download:boolean;run_id:number|null;configuration_required:boolean;has_rows?:boolean};
type Coverage = {rows:Gap[];total:number;pages:number;page:number;unavailable:number;pending:number};
type RecoveryJob = {id:number;feed:string;report_date:string;store_name:string;status:string;downloaded_row_count:number|null;imported_row_count:number|null;error_message:string|null};
type ApiResponse<T> = {success:boolean;data:T;error?:string};

export function OrderSheetRecovery({form,scanRequest=0,onRecoveryFinished}:{form:OrderSheetFormState;scanRequest?:number;onRecoveryFinished?:(resumeGeneration:boolean)=>void}) {
 const lastRequest=useRef(scanRequest);
 const scanRef=useRef<(offerApproval?:boolean) => Promise<void>>(async()=>{});
 const generationScope=useRef("");
 const [approvalOpen,setApprovalOpen]=useState(false);
 const onRecoveryFinishedRef=useRef(onRecoveryFinished);
 const refreshAfterCompletion=useRef(false);
 const scanVersion=useRef(0);
 const scopeRef=useRef("");
 const [rows,setRows]=useState<Gap[]>([]);
 const [scanning,setScanning]=useState(false);
 const [running,setRunning]=useState(false);
 const [message,setMessage]=useState("");
 const [selected,setSelected]=useState<string[]>([]);
 const [progress,setProgress]=useState({done:0,total:0});
 const [scannedScope,setScannedScope]=useState("");
 const [failures,setFailures]=useState<string[]>([]);
 const [jobIds,setJobIds]=useState<number[]>([]);
 const [jobs,setJobs]=useState<RecoveryJob[]>([]);
 const [jobCheckError,setJobCheckError]=useState("");
 const scope=JSON.stringify(form);
 const stale=scope!==scannedScope;
 useEffect(()=>{scopeRef.current=scope;},[scope]);
 const key=(r:Gap)=>`${r.store_id}:${r.source_type}:${r.day}`;
 const feeds=["normal_sales",...(form.includeRtc?["rtc"]:[]),...(form.includeWastage?["wastage"]:[])];
 async function scan(offerApproval=false) {
  if(offerApproval)generationScope.current=scope;
  if(!form.storeIds.length || !form.comparisonPeriods.length){setMessage("Select stores and comparison dates first.");return;}
  const version=++scanVersion.current;
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
     for(const row of body.data.rows)if(!(row.status==="unverified"&&row.has_rows))found.set(key(row),row);
     pages=body.data.pages;page++;
    } while(page<=pages);
   }
   const gaps=[...found.values()].sort((a,b)=>a.day.localeCompare(b.day)||a.store_name.localeCompare(b.store_name));
   if(version!==scanVersion.current||scopeRef.current!==scope)return;
   setRows(gaps);setScannedScope(scope);
   setMessage(gaps.length?`Found ${gaps.length} store/date/feed gaps. Review the proposed downloads below.`:"No missing movement data found. Check any remaining stock or supplier warnings; upload links are below.");
   if(offerApproval) {
    const eligible=gaps.filter(row=>row.can_download).slice(0,250);
    setSelected(eligible.map(key));
    if(eligible.length&&!jobIds.length)setApprovalOpen(true);
    else if(!eligible.length) {
     const pending=[...new Set(gaps.filter(row=>["queued","downloading","downloaded","importing"].includes(row.status)&&row.run_id).map(row=>row.run_id!))].slice(0,250);
     if(pending.length){refreshAfterCompletion.current=true;setJobIds(pending);setMessage("Required reports are already queued. Monitoring their imports before regenerating.");}
    }
   }
  } catch(error){if(version===scanVersion.current&&scopeRef.current===scope)setMessage(error instanceof Error?error.message:"Unable to scan missing reports.");}
  finally{if(version===scanVersion.current)setScanning(false);}
 }
 useEffect(()=>{scanRef.current=scan;onRecoveryFinishedRef.current=onRecoveryFinished;});
 async function queueApproved(confirmed=false){
  const approved=rows.filter(row=>selected.includes(key(row))&&row.can_download).slice(0,250);
  if(!approved.length||stale||scanning||running||jobIds.length)return;
  if(!confirmed&&!window.confirm(`Queue ${approved.length} selected CRM reports for download? This will not replace completed reports.`))return;
  setApprovalOpen(false);
  setRunning(true);setProgress({done:0,total:approved.length});setMessage("Submitting approved recovery jobs...");
  const failuresNow:string[]=[];
  const queuedIds:number[]=[];
  const skipped:string[]=[];
  for(let i=0;i<approved.length;i++){
   const row=approved[i];
   try{
    const response=await fetch("/api/automation/coverage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({storeId:row.store_id,feed:row.source_type,day:row.day})});
    const body=await response.json() as ApiResponse<{runId:number|null;message:string}>;
    if(!response.ok||!body.success)throw new Error(body.error||"Queue rejected");
    if(body.data?.runId)queuedIds.push(body.data.runId);
    else skipped.push(`${row.store_name} ${row.day} ${row.source_type}: ${body.data?.message||"No recovery job created"}`);
   }catch(error){failuresNow.push(`${row.store_name} ${row.day} ${row.source_type}: ${error instanceof Error?error.message:"Request failed"}`);}
   setProgress({done:i+1,total:approved.length});
  }
  setRunning(false);setSelected([]);setFailures([...failuresNow,...skipped]);
  if(failuresNow.length)generationScope.current="";
  if(queuedIds.length){
   refreshAfterCompletion.current=true;
   setJobCheckError("");
   setJobs([]);
   setJobIds(old=>[...new Set([...old,...queuedIds])].slice(-250));
  } else {
   // Another operator may have completed the reports while approval was open.
   const resume=!failuresNow.length&&generationScope.current===scopeRef.current;
   generationScope.current="";
   void scanRef.current();
   onRecoveryFinishedRef.current?.(resume);
  }
  setMessage(`${queuedIds.length} recovery jobs tracked; ${skipped.length} already completed or skipped; ${failuresNow.length} requests failed. Job IDs: ${queuedIds.length?queuedIds.join(", "):"none created"}. Progress is monitored automatically; the missing-report scan and order warnings refresh when jobs finish.`);
 }
 useEffect(()=>{
  if(scanRequest===lastRequest.current)return;
  lastRequest.current=scanRequest;
  void scanRef.current(true);
 },[scanRequest]);
 useEffect(()=>{
  if(!jobIds.length)return;
  let cancelled=false;
  let checking=false;
  async function refresh(){
   if(cancelled||checking)return;
   checking=true;
   try {
    const response=await fetch("/api/order-sheet/recovery-status?ids="+jobIds.join(","),{cache:"no-store"});
    const body=await response.json() as ApiResponse<{jobs:RecoveryJob[]}>;
    if(!response.ok||!body.success)throw new Error(body.error||"Unable to check recovery jobs.");
    if(cancelled)return;
    setJobs(body.data.jobs);setJobCheckError("");
    const finished=body.data.jobs.length===jobIds.length&&body.data.jobs.every(job=>["success","failed","partial","cancelled","paused","resumed"].includes(job.status));
    if(finished){
     setJobIds([]);
     if(refreshAfterCompletion.current){
      refreshAfterCompletion.current=false;
      const unsuccessful=body.data.jobs.filter(job=>job.status!=="success");
      setMessage(unsuccessful.length?`${unsuccessful.length} recovery job(s) did not complete successfully. Rechecking gaps; review failed or unmatched imports before retrying.`:"All recovery jobs completed. Verifying saved reports and refreshing order warnings...");
      void scanRef.current();
      const resume=!unsuccessful.length&&generationScope.current===scopeRef.current;
      generationScope.current="";
      onRecoveryFinishedRef.current?.(resume);
     }
    }
   }catch(error){if(!cancelled)setJobCheckError(error instanceof Error?error.message:"Unable to check recovery jobs.");}
   finally{checking=false;}
  }
  void refresh();
  const timer=window.setInterval(()=>void refresh(),10000);
  return ()=>{cancelled=true;window.clearInterval(timer);};
 },[jobIds]);
 const eligible=rows.filter(row=>row.can_download);
 const processingJobs=jobs.filter(job=>["queued","downloading","downloaded","importing"].includes(job.status)).length;
 const completedJobs=jobs.filter(job=>job.status==="success").length;
 const problemJobs=jobs.filter(job=>["failed","partial","paused","cancelled","resumed"].includes(job.status)).length;
 const finishedJobs=completedJobs+problemJobs;
 const completionPercent=jobs.length?Math.round(finishedJobs/jobs.length*100):0;
 return <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-slate-900" aria-label="Mieszko intelligent data recovery">
  <ConfirmAlertDialog open={approvalOpen&&!stale} onOpenChange={open=>{setApprovalOpen(open);if(!open)generationScope.current="";}}
   title="Download missing reports?"
   description={`The order needs ${selected.length} CRM reports. Approve downloading and importing the listed reports? Completed reports will be kept. The order will regenerate after successful imports if your selections stay the same.`}
   confirmLabel={`Approve download of ${selected.length} reports`} confirmVariant="default" confirming={running}
   onConfirm={()=>void queueApproved(true)}>
   <div className="max-h-64 overflow-auto text-sm"><ul>{rows.filter(row=>selected.includes(key(row))).map(row=><li key={key(row)}>{row.store_name} · {row.day} · {row.source_type.replaceAll("_"," ")}</li>)}</ul></div>
  </ConfirmAlertDialog>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h3 className="font-semibold">Mieszko · Intelligent Data Recovery</h3><p className="text-slate-600">Check exact CRM reports before placing orders. Downloads require your approval.</p></div>
   <button type="button" onClick={()=>void scan()} disabled={scanning||running} className="rounded bg-blue-700 px-3 py-2 font-medium text-white disabled:opacity-50">{scanning?"Scanning...":"Scan missing reports"}</button>
  </div>
  {message&&<p role="status" className="mt-3">{message}</p>}
  {stale&&rows.length>0&&<p role="alert">Selections changed. Scan again before approving downloads.</p>}
  {failures.length>0&&<div role="alert" className="mt-2 text-red-700">{failures.map(f=><p key={f}>{f}</p>)}</div>}
  {jobCheckError&&<p role="alert" className="mt-2 text-red-700">{jobCheckError}</p>}
  {jobs.length>0&&<div className="mt-3 rounded border bg-white p-3"><p className="font-semibold">Recovery job progress · refreshed every 10 seconds</p><p className="mt-1 text-slate-600">{processingJobs} in progress · {completedJobs} completed · {problemJobs} need attention</p><div role="progressbar" aria-label="Recovery jobs finished" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionPercent} className="mt-2 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-blue-600 transition-all" style={{width:`${completionPercent}%`}} /></div><p className="mt-1 text-xs text-slate-600">{finishedJobs} of {jobs.length} jobs finished ({completionPercent}%)</p><ul className="mt-2 space-y-1">{jobs.map(job=><li key={job.id}>#{job.id} · {job.store_name} · {job.report_date} · {job.feed.replaceAll("_"," ")} · <strong>{job.status}</strong> · downloaded {job.downloaded_row_count??0} rows · imported {job.imported_row_count??0} rows{job.error_message?" · "+job.error_message:""}</li>)}</ul></div>}
  <p className="mt-3 text-slate-600">Automatic downloads cover configured Normal Sales, RTC and Wastage reports. Book stock and supplier prices need uploads until automatic download sources are connected to this recovery flow.</p>
  <p className="mt-2 flex flex-wrap gap-3"><a href="/book-stock" className="text-blue-700 underline">Upload missing book stock</a><a href="/supplier-prices" className="text-blue-700 underline">Upload missing supplier prices</a></p>
  {rows.length>0&&<div className="mt-3">
   <p className="mb-2">{rows.length} gaps · {eligible.length} eligible for CRM download. Missing book stock and supplier prices require separate uploads.</p>
   <div className="max-h-72 overflow-auto rounded border bg-white">
    <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Approve</th><th className="p-2">Store</th><th className="p-2">Report date</th><th className="p-2">Feed</th><th className="p-2">Status</th></tr></thead><tbody>{rows.map(row=><tr key={key(row)} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Approve ${row.store_name} ${row.source_type} ${row.day}`} disabled={!row.can_download||running||scanning||stale} checked={selected.includes(key(row))} onChange={e=>setSelected(old=>e.target.checked?[...old,key(row)]:old.filter(x=>x!==key(row)))}/></td><td className="p-2">{row.store_name}</td><td className="p-2">{row.day}</td><td className="p-2">{row.source_type.replaceAll("_"," ")}</td><td className="p-2" title={row.reason}><span className="font-semibold">{row.status}</span>{row.configuration_required?" · CRM setup needed":""}<span className="block text-slate-600">{row.reason}</span></td></tr>)}</tbody></table>
   </div>
   <div className="mt-3 flex flex-wrap items-center gap-3">
    <button type="button" disabled={running||scanning||stale||!eligible.length} onClick={()=>setSelected(eligible.slice(0,250).map(key))} className="rounded border px-3 py-2">Select eligible</button>
    <button type="button" disabled={running||scanning||stale||!selected.length} onClick={()=>setSelected([])} className="rounded border px-3 py-2">Clear selection</button>
    <button type="button" disabled={running||scanning||stale||!selected.length||jobIds.length>0} onClick={()=>void queueApproved()} className="rounded bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-50">Approve & queue {selected.length} reports</button>
    <a href="/book-stock" className="text-blue-700 underline">Book stock upload</a>
    <a href="/supplier-prices" className="text-blue-700 underline">Supplier prices upload</a>
    <a href="/downloads" className="text-blue-700 underline">View live download queue</a>
    <a href="/unmatched-products" className="text-blue-700 underline">Review unmatched products</a>
   </div>
   {running&&<div className="mt-2" role="status"><p>Queue requests: {progress.done}/{progress.total}</p><progress aria-label="Recovery requests submitted" value={progress.done} max={progress.total} className="mt-1 w-full" /></div>}
  </div>}
 </section>;
}
