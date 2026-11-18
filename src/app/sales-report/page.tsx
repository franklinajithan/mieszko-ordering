"use client";
import { AppShell } from "@/components/layout/app-shell";
import { useCallback, useEffect, useState } from "react";
type Archive={date:string;name:string;size:number;created:string;manifest:{expected?:number;success?:number;failed?:number;complete?:boolean}|null};
type Run={active:boolean;run:{date:string;startedAt:string}|null;log:string;completed:number;failed:number};
function yesterdayUK(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));const today=new Date(Date.UTC(Number(obj.year),Number(obj.month)-1,Number(obj.day)));today.setUTCDate(today.getUTCDate()-1);return today.toISOString().slice(0,10)}
export default function SalesReportPage(){
 const [date,setDate]=useState(yesterdayUK);
 const [archives,setArchives]=useState<Archive[]>([]);
 const [run,setRun]=useState<Run|null>(null);
 const [loading,setLoading]=useState(true);
 const [starting,setStarting]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const refresh=useCallback(async()=>{try{
  const [a,r]=await Promise.all([fetch("/api/sales-report",{cache:"no-store"}),fetch("/api/sales-report/run",{cache:"no-store"})]);
  if(!a.ok||!r.ok)throw new Error("Unable to load report status");
  setArchives((await a.json()).archives||[]);setRun(await r.json());
 }catch(e){setError(String(e))}finally{setLoading(false)}},[]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer)},[refresh]);
 async function start(){
  if(!date)return;
  if(!window.confirm(`Download all 42 Nebula reports for ${date}? Existing valid PDFs will be reused.`))return;
  setStarting(true);setError("");setNotice("");
  try{const response=await fetch("/api/sales-report/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date})});const type=response.headers.get("content-type")||"";if(!type.includes("application/json"))throw new Error("Server returned an unexpected response");const data=await response.json();if(!response.ok)throw new Error(data.error||"Unable to start");setNotice(`Download started for ${date}. Progress will update automatically.`);await refresh()}catch(e){setError(String(e))}finally{setStarting(false)}
 }
 const latest=archives.find(a=>a.date===date);
 const stores=["Hounslow","Perivale","East Ham","Hayes","Gravesend","Watford","Streatham"];
 const logStore=(store:string)=>store==="East Ham"?"Eastham":store;
 const storeStatus=(store:string)=>{const s=logStore(store);const lines=(run?.log||"").split("\\n");const successes=lines.filter(l=>l.includes(`[SUCCESS] ${s} |`)||l.includes(`[SKIPPED] ${s} |`)).length;const failures=lines.filter(l=>l.includes(`[STORE ERROR] ${s} |`)).length;const started=lines.some(l=>l.includes(`${s} | Pass`));return {successes,failures,status:successes>=6?"Complete":run?.active&&started?"Processing":failures?"Errors":"Waiting"};};
 return <AppShell title="Sales Report" description="Daily Nebula sales reports · Select date · Download ZIP">
 <div className="space-y-5">
 <section className="rounded-xl border bg-white p-5 text-slate-900 space-y-4">
 <div><h2 className="text-lg font-semibold">Download Sales Reports</h2><p className="mt-1 text-sm text-slate-600">Automatic daily download at 06:00 UK time for the previous day · 7 stores · 42 PDF reports</p></div>
 <div className="flex flex-wrap items-end gap-3">
 <label className="flex flex-col gap-1 text-sm font-medium">Report date<input className="rounded-lg border px-3 py-2" type="date" value={date} max={yesterdayUK()} onChange={e=>setDate(e.target.value)}/></label>
 <button className="rounded-lg border px-4 py-2 text-sm font-medium" onClick={()=>setDate(yesterdayUK())}>Yesterday</button>
 <button disabled={starting||Boolean(run?.active)||!date} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" onClick={()=>void start()}>{starting?"Starting…":run?.active?"Download in progress":"Download Reports"}</button>
 {latest&&<a className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white" href={`/api/sales-report/${date}`}>Download ZIP for {date}</a>}
 </div>
 {notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 </section>
 <section className="rounded-xl border bg-white p-5 text-slate-900 space-y-3">
 <h2 className="text-lg font-semibold">Download status</h2>
 {run?.run?<><div className="flex flex-wrap justify-between gap-2 text-sm"><span><strong>{run.active?"Running":"Last manual run"}</strong> · {run.run.date}</span><span>{run.completed} reports downloaded or reused</span></div>
 <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-600 transition-all" style={{width:`${Math.min(100,run.completed/42*100)}%`}}/></div>
 <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{stores.map(s=>{const info=storeStatus(s);return <div key={s} className="rounded-lg border p-3 text-sm"><div className="font-medium">{s}</div><div className="text-slate-600">{info.successes}/6 reports · {info.status}</div></div>})}</div>
 <details><summary className="cursor-pointer text-sm font-medium">Detailed download log</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-xs">{run.log||"Waiting for first report…"}</pre></details>
 {!run.active&&run.log&&!run.log.includes("Daily ZIP:")&&<p className="text-sm text-amber-700">The last run ended without a confirmed ZIP. Review the log.</p>}
 </>:<p className="text-sm text-slate-600">No manual download started yet. Choose a date above or wait for the scheduled 06:00 run.</p>}
 </section>
 <section className="rounded-xl border bg-white p-5 text-slate-900 space-y-3">
 <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Daily ZIP history</h2><button onClick={()=>void refresh()} className="rounded border px-3 py-2 text-sm">Refresh</button></div>
 {loading?<p className="text-sm">Loading…</p>:archives.length===0?<p className="text-sm text-slate-600">No ZIP files yet. Install the Ubuntu downloader to enable automatic and manual downloads.</p>:<div className="space-y-2">{archives.map(a=><div key={a.date} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><div className="font-medium">{a.date}</div><div className="text-sm text-slate-600">{a.manifest?`${a.manifest.success??0}/${a.manifest.expected??42} reports · ${a.manifest.complete?"Complete":"Incomplete"}`:"ZIP ready · Manifest unavailable"} · {(a.size/1048576).toFixed(1)} MB</div></div><a className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" href={`/api/sales-report/${a.date}`}>Download ZIP</a></div>)}</div>}
 </section></div></AppShell>
}
