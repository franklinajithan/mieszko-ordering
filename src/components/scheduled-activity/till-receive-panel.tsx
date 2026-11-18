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
  async function refresh() {
    const r=await fetch("/api/scheduled-activity/till-receive",{cache:"no-store"});
    if(r.ok){const d=await r.json();setHistory(d.history);setEnabled(d.executionEnabled);}
  }
  useEffect(()=>{void refresh()},[]);
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
    <section className="rounded-xl border p-5"><h3 className="mb-3 font-semibold">Execution history</h3>
      <div className="space-y-3">{history.length===0?<p className="text-sm text-slate-500">No runs yet.</p>:history.map((item,i)=><div className="rounded border p-3" key={item.at+i}>
        <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{labels[item.store]||item.store} · {item.mode}</strong><span>{item.status} · {new Date(item.at).toLocaleString()}</span></div>
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs">{item.output}</pre>
      </div>)}</div>
    </section>
  </div>;
}
