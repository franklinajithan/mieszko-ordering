'use client';
import {useRouter} from 'next/navigation';
import {Button} from '@/components/ui/button';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/lib/api/client';
import {ReportCoverage} from './report-coverage';
import {londonToday} from '@/validators/crm-automation';
const feeds={normal_sales:'Normal Sales',rtc:'RTC Sales',wastage:'Wastage',book_stock:'Book Stock'};
const views=[['processing','Processing'],['queued','Waiting'],['paused','Paused'],['completed','Completed'],['partial','Partial / needs review'],['failed','Failed'],['cancelled','Cancelled'],['all','All history']] as const;
type Row={id:number;store_name:string|null;source_type:keyof typeof feeds;status:string;from_date:string|null;to_date:string|null;started_at:string;completed_at:string|null;downloaded_row_count:number|null;imported_row_count:number|null;error_message:string|null;source_file_name:string|null;automatic_retry_count?:number|null;retry_of:string|null};
type LiveRow=Pick<Row,'id'|'store_name'|'source_type'|'status'|'from_date'|'to_date'> & Partial<Pick<Row,'started_at'|'source_file_name'|'downloaded_row_count'>>;
const stages:Record<string,string>={downloading:'Opening CRM / downloading report',downloaded:'Download complete — validating file',importing:'Saving validated data to PostgreSQL'};
function reportName(row:LiveRow){return `${row.store_name??'Store removed'} · ${feeds[row.source_type]} · ${row.from_date??'Date not recorded'}${row.to_date!==row.from_date?` to ${row.to_date??'unknown'}`:''}`;}
type Queue={live:{active:LiveRow[];next:LiveRow[]};rows:Row[];counts:Record<string,number>;stores:{id:number;name:string;is_active:boolean;erp_type:string}[];total:number;page:number;pageSize:number;checkedAt:string};
export function DownloadQueue(){
 const router=useRouter();
 const yesterday=new Date(Date.parse(londonToday()+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const [from,setFrom]=useState(()=>new Date(Date.parse(yesterday+'T00:00:00Z')-6*86400000).toISOString().slice(0,10));
 const [to,setTo]=useState(yesterday);
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
  <div className="flex flex-wrap gap-3"><Button onClick={()=>router.push('/automation')}>New download / CRM settings</Button><Button variant="outline" onClick={()=>router.push('/operations')}>Office Operations</Button><Button variant="outline" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh queue</Button></div>
  <p className="text-sm">Queued reports wait for the Ubuntu worker and an enabled report feed. This screen refreshes every 5 seconds while visible. Closing it does not stop the worker. Book Stock remains manual.</p>
  <p className="text-sm text-zinc-600">After the updated nightly timer is installed, enabled stores retry eligible download failures from the last 30 report days at 02:00, 03:00, 04:00 and 05:00 London time, with at most 3 automatic retries per report. Unmatched products need mapping; parsing failures retry after a worker update.</p>
  <p className="text-sm text-zinc-600">Pause stops this attempt from importing; Resume starts a fresh attempt. A CRM download already underway may finish. An atomic database import already in progress cannot be interrupted.</p>
  {data&&<section aria-label="Live worker activity" className="grid gap-4 lg:grid-cols-2">
   <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
    <h2 className="text-lg font-semibold">Processing now</h2>
    <p className="text-xs text-zinc-600">All stores and feeds · Worker stages recorded in PostgreSQL · Checked {new Date(data.checkedAt).toLocaleTimeString('en-GB')}</p>
    {data.live.active.length?data.live.active.map(row=><article key={row.id} aria-label={`Current job ${row.id}`} className="mt-3 rounded border bg-white p-3">
     <p className="font-semibold">{reportName(row)}</p><p>Job #{row.id} · {stages[row.status]??row.status}</p>
     <progress className="mt-2 h-3 w-full accent-emerald-700" aria-label={`Job ${row.id} stage progress`} max={4} value={['queued','downloading','downloaded','importing'].indexOf(row.status)}/><p className="text-xs">Stage {['queued','downloading','downloaded','importing'].indexOf(row.status)} of 4 · Complete when saved</p>
     {row.started_at&&<p className="text-sm">Started {new Date(row.started_at).toLocaleString('en-GB')}</p>}
     <p className="text-sm">File: {row.source_file_name??'Filename recorded when download finishes'}{row.downloaded_row_count!=null?` · ${row.downloaded_row_count} rows`:''}</p>
     {row.started_at&&Date.parse(data.checkedAt)-Date.parse(row.started_at)>7200000&&<p className="text-amber-900">This attempt has been active for over two hours. Check the worker before assuming it is still progressing.</p>}
    </article>):<p className="mt-3">No report is currently recorded as processing. Waiting jobs need the worker and feed enabled.</p>}
    <Button className="mt-3" variant="outline" onClick={()=>{setView('processing');setPage(1);}}>Show processing reports</Button>
   </div>
   <div className="rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Next waiting CRM reports</h2>
    <p className="text-xs text-zinc-600">All stores · Oldest report date first · The worker selects from its enabled feeds. Book Stock is handled separately.</p>
    {data.live.next.length?<ol className="mt-3 list-decimal space-y-2 pl-5">{data.live.next.map((row,index)=><li key={row.id} aria-label={`Queue position ${index+1}`}><strong>{reportName(row)}</strong><div className="text-sm">Job #{row.id}{index===0?' · First waiting candidate':''}</div></li>)}</ol>:<p className="mt-3">No waiting CRM reports with an active store and saved CRM settings.</p>}
    <Button className="mt-3" variant="outline" onClick={()=>{setView('queued');setPage(1);}}>Show waiting reports</Button>
   </div>
  </section>}
  <div className="flex flex-wrap gap-4">
   <label>Store<select aria-label="Queue store" className="ml-2 rounded border p-2" value={storeId} onChange={e=>{setStore(e.target.value);setPage(1);}}><option value="">All stores</option>{(result?.data.stores??[]).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Feed<select aria-label="Queue feed" className="ml-2 rounded border p-2" value={feed} onChange={e=>{setFeed(e.target.value);setPage(1);}}><option value="">All feeds</option>{Object.entries(feeds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  </div>
  <div className="flex flex-wrap gap-4 rounded-xl border bg-white p-4">
   <label>Check report dates from<input aria-label="Coverage from date" className="ml-2 rounded border p-2" type="date" max={yesterday} value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>To<input aria-label="Coverage to date" className="ml-2 rounded border p-2" type="date" max={yesterday} value={to} onChange={e=>setTo(e.target.value)}/></label>
  </div>
  {result&&<ReportCoverage storeIds={storeId?[Number(storeId)]:result.data.stores.filter(s=>s.is_active&&s.erp_type==='msp').map(s=>s.id)} feeds={feed==='book_stock'?[]:feed?[feed]:['normal_sales','rtc','wastage']} from={from} to={to} onQueued={()=>setRefresh(n=>n+1)}/>}
  <p className="text-sm text-zinc-600">Reports below are ordered by sales / report date, oldest first. Current downloads finish before the worker starts the next waiting date.</p>
  <nav aria-label="Download queue views" className="flex flex-wrap gap-2">{views.map(([key,label])=><button key={key} aria-pressed={view===key} className={`rounded border px-3 py-2 ${view===key?'bg-emerald-700 text-white':'bg-white'}`} onClick={()=>{setView(key);setPage(1);}}>{label}{data?` (${count(key)})`:''}</button>)}</nav>
  {error&&<p role="alert" className="rounded border border-red-300 bg-red-50 p-3">{error}</p>}
  {message&&<p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3">{message}</p>}
  {loading&&<p role="status">Checking download queue…</p>}
  {data&&<><p className="text-sm text-zinc-600">{data.total} attempts in this view · Page {data.page} · Checked {new Date(data.checkedAt).toLocaleTimeString('en-GB')}. Counts use the selected store and feed.</p>
   <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-zinc-50"><tr>{['Job','Store','Feed / dates','Stage','Rows','Details','Controls'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.rows.map(row=><tr key={row.id} className="border-t">
    <td className="p-3">#{row.id}{row.retry_of&&<div>Retry of #{row.retry_of}</div>}{row.automatic_retry_count&&<div>Automatic retry {row.automatic_retry_count}/3</div>}</td><td className="p-3">{row.store_name??'Store removed'}</td>
    <td className="p-3">{feeds[row.source_type]}<div>{row.from_date??'Date not recorded'}{row.to_date!==row.from_date?` to ${row.to_date??'unknown'}`:''}</div></td>
    <td className="p-3"><strong>{row.status==='success'?'Saved':row.status==='partial'?'Partial — unmatched products pending':row.status}</strong><div className="text-xs">{new Date(row.started_at).toLocaleString('en-GB')}</div>{['downloading','downloaded','importing'].includes(row.status)&&<progress aria-label={`Job ${row.id} progress`} max={4} value={['queued','downloading','downloaded','importing','success'].indexOf(row.status)} />}</td>
    <td className="p-3">Downloaded: {row.downloaded_row_count??'—'}<div>Saved: {row.imported_row_count??'—'}</div></td>
    <td className="max-w-sm p-3">{row.error_message}{row.source_file_name&&<div className="text-xs text-zinc-500">{row.source_file_name}</div>}{row.status==='queued'&&<p>Waiting for the worker; verify feed is enabled if this persists.</p>}</td>
    <td className="p-3"><div className="flex flex-wrap gap-2">
     {['queued','downloading','downloaded'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'pause')} aria-label={`Pause job ${row.id}`} className="rounded border px-2 py-1">Pause</button>}
     {row.status==='paused'&&<button disabled={busy!==null} onClick={()=>void act(row,'resume')} aria-label={`Resume job ${row.id}`} className="rounded border px-2 py-1">Resume</button>}
     {['queued','downloading','downloaded','paused'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'cancel')} aria-label={`Cancel job ${row.id}`} className="rounded border px-2 py-1">Cancel</button>}
     {['success','failed','partial','cancelled'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'redownload')} aria-label={`Re-download job ${row.id}`} className="rounded border px-2 py-1">Re-download</button>}
     {row.status==='importing'&&<span>Database import committing; allow it to finish.</span>}{busy===row.id&&<span role="status">Updating…</span>}
    </div></td>
   </tr>)}</tbody></table>{!data.rows.length&&<p className="p-6">No reports in this view.</p>}</div>
   <div className="flex gap-3"><button disabled={loading||page<=1} onClick={()=>setPage(n=>n-1)}>Previous page</button><button disabled={loading||page*data.pageSize>=data.total} onClick={()=>setPage(n=>n+1)}>Next page</button></div>
  </>}
 </div>;
}
