"use client";
import { AppShell } from "@/components/layout/app-shell";
import { useCallback, useEffect, useState } from "react";
type Archive={date:string;name:string;size:number;created:string;manifest:{expected?:number;success?:number;failed?:number;complete?:boolean}|null};
export default function SalesReportPage(){
 const [archives,setArchives]=useState<Archive[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const refresh=useCallback(async()=>{try{const response=await fetch("/api/sales-report",{cache:"no-store"});if(!response.ok)throw new Error("Unable to load report history");const data=await response.json();setArchives(data.archives||[]);setError("");}catch(e){setError(String(e))}finally{setLoading(false)}},[]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>clearInterval(timer)},[refresh]);
 return <AppShell title="Sales Report" description="Previous-day Nebula reports · Daily ZIP downloads">
 <div className="space-y-5">
  <section className="rounded-xl border bg-white p-5 text-slate-900">
   <h2 className="text-lg font-semibold">Daily Sales Reports</h2>
   <p className="mt-1 text-sm text-slate-600">Scheduled for 06:00 UK time · Previous day's reports · 7 stores · 6 reports per store</p>
   <p className="mt-3 text-sm text-slate-600">Each daily ZIP contains PDFs grouped by store, a report manifest and any download errors. Archives appear here after the Ubuntu downloader creates them.</p>
  </section>
  <section className="rounded-xl border bg-white p-5 text-slate-900">
   <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Daily ZIP history</h2><button onClick={()=>void refresh()} className="rounded border px-3 py-2 text-sm">Refresh</button></div>
   {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
   {loading?<p className="text-sm">Loading reports…</p>:archives.length===0?<p className="text-sm text-slate-600">No daily ZIP files found yet. The Ubuntu downloader must be installed and complete a run before downloads appear.</p>:
   <div className="space-y-3">{archives.map(a=><div key={a.date} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
    <div><div className="font-medium">{a.date}</div><div className="text-sm text-slate-600">{a.manifest?`${a.manifest.success??0}/${a.manifest.expected??42} reports · ${a.manifest.complete?"Complete":"Incomplete"}`:"ZIP available · Manifest unavailable"} · {(a.size/1024/1024).toFixed(1)} MB</div></div>
    <a className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" href={`/api/sales-report/${a.date}`}>Download ZIP</a>
   </div>)}</div>}
  </section>
 </div></AppShell>;
}
