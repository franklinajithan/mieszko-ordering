"use client";
import { useEffect, useState } from "react";
type Entry = { at: string; store: string; mode: string; status: string; output: string };
const labels: Record<string,string> = { HNS:"Hounslow", PRV:"Perivale", EHM:"East Ham", HAY:"Hayes", GRV:"Gravesend", WAT:"Watford", STR:"Streatham" };
export function TillReceivePanel() {
  const [store,setStore]=useState("HNS");
  const [history,setHistory]=useState<Entry[]>([]);
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [token,setToken]=useState("");
  const [frequency,setFrequency]=useState("nightly");
  const [time,setTime]=useState("00:00");
  const [paused,setPaused]=useState(true);
  const [selected,setSelected]=useState<string[]>(Object.keys(labels));
  const [saving,setSaving]=useState(false);
  async function refresh() {
    const r=await fetch("/api/scheduled-activity/till-receive",{cache:"no-store"});
    if(r.ok){const d=await r.json();setHistory(d.history);setEnabled(d.executionEnabled);}
  }
  useEffect(()=>{void refresh();void fetch("/api/scheduled-activity/till-receive/schedule").then(r=>r.json()).then(d=>{setFrequency(d.frequency);setTime(d.time);setPaused(d.paused);setSelected(d.stores)}).catch(()=>{});},[]);
  async function saveSchedule(nextPaused=paused){
    setSaving(true);
    try {const r=await fetch("/api/scheduled-activity/till-receive/schedule",{method:"PUT",headers:{"Content-Type":"application/json",...(token?{"x-till-receive-token":token}:{})},body:JSON.stringify({frequency,time,stores:selected,paused:nextPaused})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Save failed");setPaused(d.paused);setMessage(d.paused?"Schedule paused and saved.":"Schedule saved and resumed. Runs require server scheduler and execution activation.");}catch(e){setMessage(String(e))}finally{setSaving(false)}
  }
  async function run(mode:"preview"|"execute") {
    if(mode==="execute" && !window.confirm("Run Nebula Till Receive for "+labels[store]+"? This performs an actual receive."))return;
    setBusy(true);setMessage("Running "+mode+" for "+labels[store]+"…");
    try {
      const r=await fetch("/api/scheduled-activity/till-receive",{method:"POST",headers:{"Content-Type":"application/json",...(token?{"x-till-receive-token":token}:{})},body:JSON.stringify({store,mode,confirmation:mode==="execute"?"RECEIVE":undefined})});
      const d=await r.json();
      setMessage(d.output||d.error||"Completed");
      await refresh();
    }catch(e){setMessage(String(e))}
    finally{setBusy(false)}
  }
  return <div className="space-y-6">
    <div className="rounded-xl border p-5 space-y-4 bg-white text-slate-900">
      <div><h2 className="text-xl font-semibold">Till Receive</h2><p className="text-sm text-slate-600">Utilities → Till Receive · Nebula · Run one store at a time</p></div>
      <label className="block text-sm font-medium">Store
        <select className="mt-1 block w-full rounded border p-2" value={store} onChange={e=>setStore(e.target.value)} disabled={busy}>
          {Object.entries(labels).map(([code,name])=><option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">Operator token (only if configured on server)
        <input className="mt-1 block w-full rounded border p-2" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-3">
        <button className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={()=>void run("preview")}>Preview selected tills</button>
        <button className="rounded bg-amber-700 px-4 py-2 text-white disabled:opacity-50" disabled={busy||!enabled} onClick={()=>void run("execute")}>Run Receive</button>
      </div>
      {!enabled&&<p className="text-sm text-amber-800">Actual receiving is disabled until server verification and explicit activation.</p>}
      {message&&<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs" role="status">{message}</pre>}
    </div>
    <section className="rounded-xl border bg-white p-5 space-y-4 text-slate-900"><h3 className="font-semibold text-lg">Automatic schedule</h3>
      <p className="text-sm text-slate-600">Saved on Ubuntu · UK time · Pausing prevents future scheduled runs.</p>
      <div className="flex flex-wrap gap-4"><label className="text-sm">Frequency<select className="mt-1 block rounded border p-2" value={frequency} onChange={e=>setFrequency(e.target.value)}><option value="1h">Every hour</option><option value="2h">Every 2 hours</option><option value="12h">Every 12 hours</option><option value="nightly">Every night</option></select></label>
      {frequency==="nightly"&&<label className="text-sm">UK time<input className="mt-1 block rounded border p-2" type="time" value={time} onChange={e=>setTime(e.target.value)}/></label>}</div>
      <fieldset><legend className="text-sm font-medium">Stores for scheduled runs</legend><div className="mt-2 flex flex-wrap gap-3">{Object.entries(labels).map(([code,name])=><label key={code} className="text-sm"><input type="checkbox" className="mr-1" checked={selected.includes(code)} onChange={e=>setSelected(old=>e.target.checked?[...old,code]:old.filter(x=>x!==code))}/>{name}</label>)}</div></fieldset>
      <div className="flex flex-wrap items-center gap-3"><button disabled={saving||!selected.length} onClick={()=>void saveSchedule()} className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50">Save schedule</button><button disabled={saving||!selected.length} onClick={()=>void saveSchedule(!paused)} className="rounded border px-4 py-2">{paused?"Resume":"Pause"} schedule</button><span className="text-sm">{paused?"Paused":"Scheduled (subject to server activation)"}</span></div>
    </section>
    <section className="rounded-xl border p-5"><h3 className="mb-3 font-semibold">Execution history</h3>
      <div className="space-y-3">{history.length===0?<p className="text-sm text-slate-500">No runs yet.</p>:history.map((item,i)=><div className="rounded border p-3" key={item.at+i}>
        <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{labels[item.store]||item.store} · {item.mode}</strong><span>{item.status} · {new Date(item.at).toLocaleString()}</span></div>
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs">{item.output}</pre>
      </div>)}</div>
    </section>
  </div>;
}
