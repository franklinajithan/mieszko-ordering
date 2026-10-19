'use client';
import {useRouter} from 'next/navigation';
import {Button} from '@/components/ui/button';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/lib/api/client';
const feeds={normal_sales:'Normal Sales',rtc:'RTC Sales',wastage:'Wastage',book_stock:'Book Stock'};
const views=[['processing','Processing'],['queued','Waiting'],['paused','Paused'],['completed','Completed'],['failed','Failed'],['cancelled','Cancelled'],['all','All history']] as const;
type Row={stage:string|null;matched_row_count:string|null;unmatched_row_count:string|null;unmatched_identifier_count:string|null;can_retry_import:boolean;diagnostics:{unknown_product_codes?:string[];unmatched_barcodes?:string[];identifier_resolutions?:Record<string,unknown>};id:number;store_name:string|null;source_type:keyof typeof feeds;status:string;from_date:string|null;to_date:string|null;started_at:string;completed_at:string|null;downloaded_row_count:number|null;imported_row_count:number|null;error_message:string|null;source_file_name:string|null;retry_of:string|null};
type LiveRow=Pick<Row,'id'|'store_name'|'source_type'|'status'|'from_date'|'to_date'> & Partial<Pick<Row,'started_at'|'source_file_name'|'downloaded_row_count'|'stage'>>;
const stages:Record<string,string>={parsing:'Parsing report',matching:'Matching catalogue identifiers',retrying:'Retrying temporary CRM failure',downloading:'Opening CRM / downloading report',downloaded:'Download complete — validating file',importing:'Saving validated data to PostgreSQL'};
function reportName(row:LiveRow){return `${row.store_name??'Store removed'} · ${feeds[row.source_type]} · ${row.from_date??'Date not recorded'}${row.to_date!==row.from_date?` to ${row.to_date??'unknown'}`:''}`;}
type Queue={live:{active:LiveRow[];next:LiveRow[]};rows:Row[];counts:Record<string,number>;stores:{id:number;name:string}[];total:number;page:number;pageSize:number;checkedAt:string};
export function DownloadQueue(){
 const router=useRouter();
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
 async function act(row:Row,action:'pause'|'resume'|'cancel'|'redownload'|'retry_import'){
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
  <p className="text-sm text-zinc-600">Pause stops this attempt from importing; Resume starts a fresh attempt. A CRM download already underway may finish. An atomic database import already in progress cannot be interrupted.</p>
  {data&&<section aria-label="Live worker activity" className="grid gap-4 lg:grid-cols-2">
   <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
    <h2 className="text-lg font-semibold">Processing now</h2>
    <p className="text-xs text-zinc-600">All stores and feeds · Worker stages recorded in PostgreSQL · Checked {new Date(data.checkedAt).toLocaleTimeString('en-GB')}</p>
    {data.live.active.length?data.live.active.map(row=><article key={row.id} aria-label={`Current job ${row.id}`} className="mt-3 rounded border bg-white p-3">
     <p className="font-semibold">{reportName(row)}</p><p>Job #{row.id} · {stages[row.stage??row.status]??row.status}</p>
     {row.started_at&&<p className="text-sm">Started {new Date(row.started_at).toLocaleString('en-GB')}</p>}
     <p className="text-sm">File: {row.source_file_name??'Filename recorded when download finishes'}{row.downloaded_row_count!=null?` · ${row.downloaded_row_count} rows`:''}</p>
     {row.started_at&&Date.parse(data.checkedAt)-Date.parse(row.started_at)>7200000&&<p className="text-amber-900">This attempt has been active for over two hours. Check the worker before assuming it is still progressing.</p>}
    </article>):<p className="mt-3">No report is currently recorded as processing. Waiting jobs need the worker and feed enabled.</p>}
    <Button className="mt-3" variant="outline" onClick={()=>{setView('processing');setPage(1);}}>Show processing reports</Button>
   </div>
   <div className="rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Next waiting CRM reports</h2>
    <p className="text-xs text-zinc-600">All stores · Oldest job first · The worker selects from its enabled feeds. Book Stock is handled separately.</p>
    {data.live.next.length?<ol className="mt-3 list-decimal space-y-2 pl-5">{data.live.next.map((row,index)=><li key={row.id} aria-label={`Queue position ${index+1}`}><strong>{reportName(row)}</strong><div className="text-sm">Job #{row.id}{index===0?' · First waiting candidate':''}</div></li>)}</ol>:<p className="mt-3">No waiting CRM reports with an active store and saved CRM settings.</p>}
    <Button className="mt-3" variant="outline" onClick={()=>{setView('queued');setPage(1);}}>Show waiting reports</Button>
   </div>
  </section>}
  <div className="flex flex-wrap gap-4">
   <label>Store<select aria-label="Queue store" className="ml-2 rounded border p-2" value={storeId} onChange={e=>{setStore(e.target.value);setPage(1);}}><option value="">All stores</option>{(result?.data.stores??[]).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Feed<select aria-label="Queue feed" className="ml-2 rounded border p-2" value={feed} onChange={e=>{setFeed(e.target.value);setPage(1);}}><option value="">All feeds</option>{Object.entries(feeds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  </div>
  <nav aria-label="Download queue views" className="flex flex-wrap gap-2">{views.map(([key,label])=><button key={key} aria-pressed={view===key} className={`rounded border px-3 py-2 ${view===key?'bg-emerald-700 text-white':'bg-white'}`} onClick={()=>{setView(key);setPage(1);}}>{label}{data?` (${count(key)})`:''}</button>)}</nav>
  {error&&<p role="alert" className="rounded border border-red-300 bg-red-50 p-3">{error}</p>}
  {message&&<p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3">{message}</p>}
  {loading&&<p role="status">Checking download queue…</p>}
  {data&&<><p className="text-sm text-zinc-600">{data.total} attempts in this view · Page {data.page} · Checked {new Date(data.checkedAt).toLocaleTimeString('en-GB')}. Counts use the selected store and feed.</p>
   <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm md:min-w-[1000px]"><thead className="hidden bg-zinc-50 md:table-header-group"><tr>{['Job','Store','Feed / dates','Stage','Rows','Details','Controls'].map(h=><th key={h} className="block p-2 md:table-cell md:p-3">{h}</th>)}</tr></thead><tbody className="block md:table-row-group">{data.rows.map(row=><tr key={row.id} className="block border-t p-3 md:table-row md:p-0">
    <td className="block p-2 md:table-cell md:p-3">#{row.id}{row.retry_of&&<div>Retry of #{row.retry_of}</div>}</td><td className="block p-2 md:table-cell md:p-3">{row.store_name??'Store removed'}</td>
    <td className="block p-2 md:table-cell md:p-3">{feeds[row.source_type]}<div>{row.from_date??'Date not recorded'}{row.to_date!==row.from_date?` to ${row.to_date??'unknown'}`:''}</div></td>
    <td className="block p-2 md:table-cell md:p-3"><strong>{row.status==='success'?'Saved':(['downloading','downloaded','importing'].includes(row.status)?row.stage??row.status:row.status)}</strong><div className="text-xs">{new Date(row.started_at).toLocaleString('en-GB')}</div>{['downloading','downloaded','importing'].includes(row.status)&&<p className="text-xs" aria-live="polite">{stages[row.stage??row.status]??row.status}</p>}</td>
    <td className="block p-2 md:table-cell md:p-3">Downloaded: {row.downloaded_row_count??'—'}<div>Matched: {row.matched_row_count??'—'}</div><div>Unmatched rows: {row.unmatched_row_count??'—'}</div><div>Unmatched identifiers: {row.unmatched_identifier_count??'—'}</div><div>Saved: {row.imported_row_count??'—'}</div></td>
    <td className="block max-w-sm p-2 md:table-cell md:p-3">{row.error_message}{row.error_message&&<details><summary className="cursor-pointer py-2">Error details / review products</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(row.diagnostics,null,2)}</pre>{[...(row.diagnostics?.unknown_product_codes??[]),...(row.diagnostics?.unmatched_barcodes??[])].map(code=><IdentifierReview key={code} runId={row.id} identifier={code} onSaved={()=>setRefresh(n=>n+1)}/>)}</details>}{row.source_file_name&&<div className="text-xs text-zinc-500">{row.source_file_name}</div>}{row.status==='queued'&&<p>Waiting for the worker; verify feed is enabled if this persists.</p>}</td>
    <td className="block p-2 md:table-cell md:p-3"><div className="flex flex-wrap gap-2">
     {['queued','downloading','downloaded'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'pause')} aria-label={`Pause job ${row.id}`} className="rounded border px-3 py-2">Pause</button>}
     {row.status==='paused'&&<button disabled={busy!==null} onClick={()=>void act(row,'resume')} aria-label={`Resume job ${row.id}`} className="rounded border px-3 py-2">Resume</button>}
     {['queued','downloading','downloaded','paused'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'cancel')} aria-label={`Cancel job ${row.id}`} className="rounded border px-3 py-2">Cancel</button>}
     {row.status==='failed'&&row.can_retry_import&&<button disabled={busy!==null} onClick={()=>void act(row,'retry_import')} aria-label={`Retry import job ${row.id}`} className="rounded border px-3 py-2">Retry Import</button>}
     {['success','failed','cancelled'].includes(row.status)&&<button disabled={busy!==null} onClick={()=>void act(row,'redownload')} aria-label={`Re-download job ${row.id}`} className="rounded border px-3 py-2">Re-download</button>}
     {row.status==='importing'&&<span>Database import committing; allow it to finish.</span>}{busy===row.id&&<span role="status">Updating…</span>}
    </div></td>
   </tr>)}</tbody></table>{!data.rows.length&&<p className="p-6">No reports in this view.</p>}</div>
   <div className="flex gap-3"><button disabled={loading||page<=1} onClick={()=>setPage(n=>n-1)}>Previous page</button><button disabled={loading||page*data.pageSize>=data.total} onClick={()=>setPage(n=>n+1)}>Next page</button></div>
  </>}
 </div>;
}

function IdentifierReview({runId,identifier,onSaved}:{runId:number;identifier:string;onSaved:()=>void}){
 const [search,setSearch]=useState(''),[products,setProducts]=useState<{id:number;store_product_code:string;name:string}[]>([]),[selected,setSelected]=useState(''),[evidence,setEvidence]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function find(){setBusy(true);const response=await apiRequest<typeof products>(`/download-queue?reviewRunId=${runId}&search=${encodeURIComponent(search)}`);if(response.success)setProducts(response.data);else setMessage(response.error);setBusy(false);}
 async function save(){setBusy(true);const response=await apiRequest<{message:string}>('/download-queue',{method:'PATCH',body:{runId,identifier,storeProductId:Number(selected),evidence}});setMessage(response.success?response.data.message:response.error);if(response.success)onSaved();setBusy(false);}
 return <fieldset className="my-3 space-y-2 rounded border p-2"><legend>Resolve {identifier}</legend>
 <p className="text-xs">Verify the CRM item against the catalogue. This mapping applies only to this report and its import retries.</p>
 <input aria-label={`Search product for ${identifier}`} className="w-full rounded border p-2" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Product code or name"/>
 <button disabled={busy} className="rounded border px-3 py-2" onClick={()=>void find()}>Search store catalogue</button>
 <select aria-label={`Verified product for ${identifier}`} className="w-full rounded border p-2" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select verified product</option>{products.map(p=><option key={p.id} value={p.id}>{p.store_product_code} — {p.name}</option>)}</select>
 <textarea aria-label={`Verification evidence for ${identifier}`} className="w-full rounded border p-2" value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Evidence confirming the same product (required)"/>
 <button disabled={busy||!selected||evidence.trim().length<10} className="rounded border px-3 py-2" onClick={()=>void save()}>Save verified mapping</button>{message&&<p role="status">{message}</p>}
 </fieldset>;
}
