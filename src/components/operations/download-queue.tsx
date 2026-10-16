'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/lib/api/client';
const feeds={normal_sales:'Normal Sales',rtc:'RTC Sales',wastage:'Wastage',book_stock:'Book Stock'};
const views=[['processing','Processing'],['queued','Waiting'],['paused','Paused'],['completed','Completed'],['failed','Failed'],['cancelled','Cancelled'],['all','All history']] as const;
type Row={id:number;store_name:string|null;source_type:keyof typeof feeds;status:string;from_date:string|null;to_date:string|null;started_at:string;completed_at:string|null;downloaded_row_count:number|null;imported_row_count:number|null;error_message:string|null;source_file_name:string|null;retry_of:string|null};
type Queue={rows:Row[];counts:Record<string,number>;stores:{id:number;name:string}[];total:number;page:number;pageSize:number;checkedAt:string};
export function DownloadQueue(){
 const [view,setView]=useState('processing'),[storeId,setStore]=useState(''),[feed,setFeed]=useState(''),[page,setPage]=useState(1);
 const [result,setResult]=useState<{query:string;data:Queue}|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState<number|null>(null),[refresh,setRefresh]=useState(0);
 const query=new URLSearchParams({view,page:String(page),...(storeId?{storeId}:{}),...(feed?{feed}:{})}).toString();
 useEffect(()=>{
  const controller=new AbortController();let reading=false;
  async function load(){
   if(reading)return;reading=true;setLoading(true);
   try{const response=await apiRequest<Queue>(`/download-queue?${query}`,{signal:controller.signal});if(controller.signal.aborted)return;if(response.success){setResult({query,data:response.data});setError('');}else setError(response.error);}
   finally{reading=false;if(!controller.signal.aborted)setLoading(false);}
  }
  void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},5000);
  return()=>{controller.abort();clearInterval(timer);};
 },[query,refresh]);
 async function act(row:Row,action:'pause'|'resume'|'cancel'|'redownload'){
  setBusy(row.id);setError('');setMessage('');
  const response=await apiRequest<{message:string}>('/download-queue',{method:'POST',body:{runId:row.id,action}});
  if(response.success){setMessage(response.data.message);setRefresh(n=>n+1);}else setError(response.error);
  setBusy(null);
 }
 const data=result?.query===query?result.data:null;
 const counts=data?.counts??{};
 const count=(key:string)=>key==='processing'?['downloading','downloaded','importing'].reduce((n,s)=>n+(counts[s]??0),0):key==='completed'?(counts.success??0):key==='all'?Object.values(counts).reduce((n,v)=>n+v,0):counts[key]??0;
 return <div className="space-y-4">
  <div className="flex flex-wrap gap-4"><Link className="text-blue-700 underline" href="/automation">CRM URLs and new download requests</Link><Link className="text-blue-700 underline" href="/operations">Office Operations</Link><button className="rounded border bg-white px-3 py-1" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh queue</button></div>
  <p className="text-sm">Queued reports wait for the Ubuntu worker and an enabled report feed. This screen refreshes every 5 seconds while visible. Closing it does not stop the worker. Book Stock remains manual.</p>
  <p className="text-sm text-zinc-600">Pause stops this attempt from importing; Resume starts a fresh attempt. A CRM download already underway may finish. An atomic database import already in progress cannot be interrupted.</p>
  <div className="flex flex-wrap gap-4">
   <label>Store<select aria-label="Queue store" className="ml-2 rounded border p-2" value={storeId} onChange={e=>{setStore(e.target.value);setPage(1);}}><option value="">All stores</option>{(result?.data.stores??[]).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Feed<select aria-label="Queue feed" className="ml-2 rounded border p-2" value={feed} onChange={e=>{setFeed(e.target.value);setPage(1);}}><option value="">All feeds</option>{Object.entries(feeds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  </div>
  <nav aria-label="Download queue views" className="flex flex-wrap gap-2">{views.map(([key,label])=><button key={key} aria-pressed={view===key} className={`rounded border px-3 py-2 ${view===key?'bg-emerald-700 text-white':'bg-white'}`} onClick={()=>{setView(key);setPage(1);}}>{label}{data?` (${count(key)})`:''}</button>)}</nav>
  {error&&<p role="alert" className="rounded border border-red-300 bg-red-50 p-3">{error}</p>}
  {message&&<p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3">{message}</p>}
  {loading&&<p role="status">Checking download queue…</p>}
  {data&&<><p className="text-sm text-zinc-600">{data.total} attempts in this view · Page {data.page} · Checked {new Date(data.checkedAt).toLocaleTimeString('en-GB')}. Counts use the selected store and feed.</p>
   <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-zinc-50"><tr>{['Job','Store','Feed / dates','Stage','Rows','Details','Controls'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row.id} className="border-t">
    <td className="p-3">#{row.id}{row.retry_of&&<div>Retry of #{row.retry_of}</div>}</td><td className="p-3">{row.store_name??'Store removed'}</td>
    <td className="p-3">{feeds[row.source_type]}<div>{row.from_date??'Date not recorded'}{row.to_date!==row.from_date?` to ${row.to_date??'unknown'}`:''}</div></td>
    <td className="p-3"><strong>{row.status==='success'?'Saved':row.status}</strong><div className="text-xs">{new Date(row.started_at).toLocaleString('en-GB')}</div>{['downloading','downloaded','importing'].includes(row.status)&&<progress aria-label={`Job ${row.id} progress`} max={4} value={['queued','downloading','downloaded','importing','success'].indexOf(row.status)} />}</td>
    <td className="p-3">Downloaded: {row.downloaded_row_count??'—'}<div>Saved: {row.imported_row_count??'—'}</div></td>
    <td className="max-w-sm p-3">{row.error_message}{row.source_file_name&&<div className="text-xs text-zinc-500">{row.source_file_name}</div>}{row.status==='queued'&&<p>Waiting for the worker; verify feed is enabled if this persists.</p>}</td>
    <td className="p-3"><div className="flex flex-wrap gap-2">
     {['queued','downloading','downloaded'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'pause')} aria-label={`Pause job ${row.id}`} className="rounded border px-2 py-1">Pause</button>}
     {row.status==='paused'&&<button disabled={busy!==null} onClick={()=>void act(row,'resume')} aria-label={`Resume job ${row.id}`} className="rounded border px-2 py-1">Resume</button>}
     {['queued','downloading','downloaded','paused'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'cancel')} aria-label={`Cancel job ${row.id}`} className="rounded border px-2 py-1">Cancel</button>}
     {['success','failed','cancelled'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'redownload')} aria-label={`Re-download job ${row.id}`} className="rounded border px-2 py-1">Re-download</button>}
     {row.status==='importing'&&<span>Database import committing; allow it to finish.</span>}{busy===row.id&&<span role="status">Updating…</span>}
    </div></td>
   </tr>)}</tbody></table>{!data.rows.length&&<p className="p-6">No reports in this view.</p>}</div>
   <div className="flex gap-3"><button disabled={loading||page<=1} onClick={()=>setPage(n=>n-1)}>Previous page</button><button disabled={loading||page*data.pageSize>=data.total} onClick={()=>setPage(n=>n+1)}>Next page</button></div>
  </>}
 </div>;
}
