'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api/client';
import { historicalImportDates,londonToday } from '@/validators/crm-automation';
const labels = {normal_sales:'Normal Sales',rtc:'RTC Sales',wastage:'Wastage'};
type Props = {storeIds:number[];feeds:string[];from:string;to:string;onQueued?:()=>void};
type CoverageRow = {store_id:number;store_name:string;source_type:keyof typeof labels;day:string;status:string;available:boolean;has_rows:boolean;run_id:number|null;can_download:boolean;reason:string;configuration_required:boolean};
type Coverage = {expected:number;available:number;unavailable:number;pending:number;actionRequired:number;percentage:number;rows:CoverageRow[];total:number;page:number;pages:number;checkedAt:string};
const stages:Record<string,string> = {missing:'Not available',unverified:'Complete report not verified',success:'Available',queued:'Waiting',downloading:'Downloading',downloaded:'Validating',importing:'Saving',failed:'Download / import failed',partial:'Partial — needs product review',paused:'Paused',cancelled:'Cancelled',resumed:'Resumed'};
export function ReportCoverage({storeIds,feeds,from,to,onQueued}:Props) {
 let error = '';
 try {
  historicalImportDates(from,to);
  if (to>=londonToday()) error='Choose completed report dates, up to yesterday in London time.';
 } catch (e) { error=e instanceof Error ? e.message : 'Choose valid report dates.'; }
 if (!storeIds.length || !feeds.length) error='Select stores and movement feeds to check missing dates. Book Stock remains manual.';
 const query = new URLSearchParams({stores:[...storeIds].sort((a,b)=>a-b).join(','),feeds:[...feeds].sort().join(','),from,to}).toString();
 return <section aria-label="Report date coverage" className="space-y-3 rounded-xl border bg-white p-4">
  <h2 className="text-xl font-semibold">Report dates and missing downloads</h2>
  <p className="text-sm text-zinc-600">Checks every selected store, feed and date, oldest first. A complete saved report counts as available, including a verified zero report. Saved rows and partial imports remain visible while incomplete reports need review.</p>
  {error ? <p role="status">{error}</p> : <CoverageResults key={query} query={query} onQueued={onQueued}/>}
 </section>;
}
function CoverageResults({query,onQueued}:{query:string;onQueued?:()=>void}) {
 const [page,setPage]=useState(1),[missingOnly,setMissingOnly]=useState(true),[refresh,setRefresh]=useState(0);
 const [result,setResult]=useState<{query:string;data:Coverage}|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState<string|null>(null);
 const requestQuery=`${query}&page=${page}&missingOnly=${missingOnly}`;
 useEffect(()=>{
  const controller=new AbortController();let reading=false;
  async function load() {
   if (reading || document.visibilityState!=='visible') return;
   reading=true;
   try {
    const response=await apiRequest<Coverage>(`/automation/coverage?${requestQuery}`,{signal:controller.signal});
    if (controller.signal.aborted) return;
    if (response.success) {setResult({query:requestQuery,data:response.data});setError('');}
    else setError('Date coverage could not be refreshed. '+response.error);
   } finally {reading=false;}
  }
  void load();const timer=setInterval(()=>void load(),5000);
  return ()=>{controller.abort();clearInterval(timer);};
 },[requestQuery,refresh]);
 const data=result?.query===requestQuery ? result.data : null;
 async function download(row:CoverageRow) {
  const key=`${row.store_id}:${row.source_type}:${row.day}`;
  setBusy(key);setMessage('');setError('');
  const response=await apiRequest<{message:string}>('/automation/coverage',{method:'POST',body:{storeId:row.store_id,feed:row.source_type,day:row.day}});
  if (response.success) {setMessage(response.data.message);setRefresh(n=>n+1);onQueued?.();}
  else setError(response.error);
  setBusy(null);
 }
 return <>
  {error&&<p role="alert" className="rounded border border-red-300 bg-red-50 p-3">{error}</p>}
  {message&&<p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3">{message}</p>}
  <label className="flex gap-2"><input type="checkbox" checked={missingOnly} onChange={e=>{setMissingOnly(e.target.checked);setPage(1);}}/>Show only dates without a complete report</label>
  <Button variant="outline" onClick={()=>setRefresh(n=>n+1)}>Check missing dates</Button>
  {!data ? <p role="status">Checking report dates…</p> : <>
   <p className="font-medium">{data.available} of {data.expected} reports available · {data.percentage}% complete</p>
   <progress className="h-4 w-full accent-emerald-700" aria-label="Completed report coverage" max={Math.max(1,data.expected)} value={data.available}/>
   <p role="status" className={data.unavailable?'text-amber-900':'text-emerald-800'}>{data.unavailable ? `${data.unavailable} reports do not have a complete import: ${data.pending} waiting or processing; ${data.actionRequired} need action.` : data.expected ? 'All selected report dates are available.' : 'No active MSP stores match this selection.'}</p>
   <p className="text-xs text-zinc-600">Updated {new Date(data.checkedAt).toLocaleTimeString('en-GB')}. Refreshes every 5 seconds. Progress counts saved reports; it does not measure file transfer bytes.</p>
   <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr>{['Report date','Store','Feed','Status','Details','Action'].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead>
    <tbody>{data.rows.map(row=><tr key={`${row.day}:${row.store_id}:${row.source_type}`} className="border-t" aria-label={`${row.store_name} ${labels[row.source_type]} ${row.day} coverage`}>
     <td className="whitespace-nowrap p-2">{row.day}</td><td className="p-2">{row.store_name}</td><td className="p-2">{labels[row.source_type]}</td>
     <td className="p-2 font-medium">{stages[row.status]??row.status}</td><td className="p-2">{row.reason}{row.configuration_required&&<p>Save this store’s CRM URL in CRM settings to enable downloads.</p>}</td>
     <td className="p-2">{row.can_download&&<Button variant="outline" disabled={busy!==null} onClick={()=>void download(row)} aria-label={`Download ${row.store_name} ${labels[row.source_type]} ${row.day}`}>{busy===`${row.store_id}:${row.source_type}:${row.day}`?'Queueing…':'Download this date'}</Button>}
      {row.status==='partial'&&<Link className="block text-emerald-800 underline" href="/unmatched-products">Review unmatched products</Link>}
      {['paused','resumed'].includes(row.status)&&<Link href="/downloads" className="underline">Resume in Download Queue</Link>}
     </td></tr>)}</tbody></table>
    {!data.rows.length&&<p className="p-3">No missing dates in this selection.</p>}
   </div>
   {data.pages>1&&<div className="flex items-center gap-4"><Button variant="outline" disabled={data.page<=1} onClick={()=>setPage(data.page-1)}>Previous dates</Button><span>Page {data.page} of {data.pages}</span><Button variant="outline" disabled={data.page>=data.pages} onClick={()=>setPage(data.page+1)}>Next dates</Button></div>}
  </>}
 </>;
}
