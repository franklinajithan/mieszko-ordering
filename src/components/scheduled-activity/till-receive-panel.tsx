"use client";
import { useEffect, useState } from "react";

type Entry = { at: string; store: string; mode: string; status: string; output: string };
type Schedule = { frequency: string; time: string; stores: string[]; paused: boolean };
const labels: Record<string,string> = { HNS:"Hounslow", PRV:"Perivale", EHM:"East Ham", HAY:"Hayes", GRV:"Gravesend", WAT:"Watford", STR:"Streatham" };
const defaults: Schedule = { frequency:"nightly", time:"00:00", stores:Object.keys(labels), paused:true };

export function TillReceivePanel() {
  const [schedule,setSchedule]=useState<Schedule>(defaults);
  const [saved,setSaved]=useState<Schedule>(defaults);
  const [history,setHistory]=useState<Entry[]>([]);
  const [enabled,setEnabled]=useState(false);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [manualStores,setManualStores]=useState<string[]>([]);
  const [running,setRunning]=useState(false);
  const changed=JSON.stringify(schedule)!==JSON.stringify(saved);

  async function refresh() {
    const [configResponse,historyResponse]=await Promise.all([
      fetch("/api/scheduled-activity/till-receive/schedule",{cache:"no-store"}),
      fetch("/api/scheduled-activity/till-receive",{cache:"no-store"})
    ]);
    if(!configResponse.ok||!historyResponse.ok)throw new Error("Unable to load schedule status");
    const config=await configResponse.json();
    const activity=await historyResponse.json();
    const next={frequency:config.frequency,time:config.time,stores:config.stores,paused:config.paused};
    setSchedule(next);setSaved(next);setHistory(activity.history||[]);setEnabled(Boolean(activity.executionEnabled));
  }
  useEffect(()=>{void refresh().catch(e=>setError(String(e))).finally(()=>setLoading(false));},[]);

  async function save(paused=schedule.paused) {
    setSaving(true);setMessage("");setError("");
    try {
      const next={...schedule,paused};
      const response=await fetch("/api/scheduled-activity/till-receive/schedule",{
        method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Unable to save schedule");
      const current={frequency:data.frequency,time:data.time,stores:data.stores,paused:data.paused};
      setSchedule(current);setSaved(current);
      setMessage(current.paused?"Schedule saved and paused.":"Schedule saved and resumed.");
    }catch(e){setError(String(e));}finally{setSaving(false);}
  }
  async function runManual(){
    if(!manualStores.length)return;
    const names=manualStores.map(s=>labels[s]).join(", ");
    if(!window.confirm(`Run actual Till Receive NOW for ${manualStores.length} store(s): ${names}?`))return;
    setRunning(true);setError("");setMessage("Running manual Till Receive. Please wait for the results.");
    try {
      const response=await fetch("/api/scheduled-activity/till-receive/manual",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stores:manualStores,confirmation:"RECEIVE"})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Manual run failed");
      setMessage(`Manual run completed: ${data.success} succeeded, ${data.failed} failed. See execution history below.`);
      const updated=await fetch("/api/scheduled-activity/till-receive",{cache:"no-store"}).then(r=>r.json());
      setHistory(updated.history||[]);
    }catch(e){setError(String(e))}finally{setRunning(false)}
  }
  function update(next:Partial<Schedule>){setSchedule(previous=>({...previous,...next}));}
  return <div className="space-y-5">
    <section className="rounded-xl border bg-white p-5 text-slate-900 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">Till Receive schedule</h2>
          <p className="mt-1 text-sm text-slate-600">Automate Nebula Till Receive for your selected stores.</p></div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${schedule.paused?"bg-slate-100 text-slate-700":enabled?"bg-green-100 text-green-800":"bg-amber-100 text-amber-800"}`}>
          {schedule.paused?"Paused":enabled?"Enabled":"Execution not activated"}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Repeat
          <select disabled={loading||saving} className="mt-2 w-full rounded-lg border p-3" value={schedule.frequency} onChange={e=>update({frequency:e.target.value})}>
            <option value="1h">Every 1 hour</option><option value="2h">Every 2 hours</option>
            <option value="12h">Every 12 hours</option><option value="nightly">Every night</option>
          </select>
        </label>
        {schedule.frequency==="nightly"&&<label className="block text-sm font-medium">Run at (UK time)
          <input disabled={loading||saving} type="time" className="mt-2 w-full rounded-lg border p-3" value={schedule.time} onChange={e=>update({time:e.target.value})}/>
        </label>}
      </div>
      <fieldset><legend className="text-sm font-medium">Stores ({schedule.stores.length} selected)</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(labels).map(([code,name])=>
          <label key={code} className="flex items-center gap-2 rounded-lg border px-3 py-3 text-sm">
            <input type="checkbox" disabled={loading||saving} checked={schedule.stores.includes(code)}
              onChange={e=>update({stores:e.target.checked?[...schedule.stores,code]:schedule.stores.filter(value=>value!==code)})}/>
            {name}
          </label>)}</div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <button disabled={loading||saving||!schedule.stores.length||!changed} onClick={()=>void save()} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">Save changes</button>
        <button disabled={loading||saving||!schedule.stores.length} onClick={()=>void save(!schedule.paused)}
          className={`rounded-lg border px-5 py-2.5 text-sm font-medium ${schedule.paused?"border-green-700 text-green-800":"border-amber-700 text-amber-800"}`}>
          {schedule.paused?"Resume schedule":"Pause schedule"}
        </button>
        {changed&&<span className="text-sm text-amber-700">Unsaved changes</span>}
      </div>
      {!enabled&&<p className="text-sm text-amber-800">Automatic receiving is not yet activated on the Ubuntu server. The schedule can be configured and paused safely.</p>}
      {message&&<p role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{message}</p>}
      {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </section>
    <section className="rounded-xl border bg-white p-5 text-slate-900 space-y-4">
      <div><h3 className="text-lg font-semibold">Run Till Receive now</h3><p className="mt-1 text-sm text-slate-600">Run selected shops immediately. This does not change or resume your automatic schedule.</p></div>
      <div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-1.5 text-sm" disabled={running} onClick={()=>setManualStores(Object.keys(labels))}>Select all stores</button><button className="rounded border px-3 py-1.5 text-sm" disabled={running} onClick={()=>setManualStores([])}>Clear selection</button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(labels).map(([code,name])=><label key={code} className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" disabled={running} checked={manualStores.includes(code)} onChange={e=>setManualStores(old=>e.target.checked?[...old,code]:old.filter(s=>s!==code))}/>{name}</label>)}</div>
      <button className="rounded-lg bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={running||!manualStores.length} onClick={()=>void runManual()}>{running?"Receiving tills…":`Run Till Receive now (${manualStores.length})`}</button>
      {running&&<p role="status" className="text-sm">Processing selected stores. Do not submit another run.</p>}
    </section>
    <section className="rounded-xl border bg-white p-5 text-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Execution history</h3>
        <button className="rounded border px-3 py-1.5 text-sm" onClick={()=>void refresh().catch(e=>setError(String(e)))}>Refresh</button>
      </div>
      {history.length===0?<p className="text-sm text-slate-500">No activity recorded yet.</p>:
        <div className="space-y-3">{history.slice(0,20).map((entry,index)=><details className="rounded-lg border p-3" key={entry.at+index}>
          <summary className="cursor-pointer text-sm"><strong>{labels[entry.store]||entry.store}</strong> · {entry.mode} ·
            <span className={entry.status==="success"?"text-green-700":"text-red-700"}> {entry.status}</span> · {new Date(entry.at).toLocaleString()}</summary>
          <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{entry.output}</pre>
        </details>)}</div>}
    </section>
  </div>;
}
