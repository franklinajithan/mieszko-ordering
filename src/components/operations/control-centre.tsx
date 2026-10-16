'use client';
import {useCallback,useEffect,useState,useRef} from 'react';
import Link from 'next/link';
import {DataOperationsStatus} from '@/components/layout/data-operations-status';
import type {ControlCentre} from '@/services/operations/control-centre.service';
import {reportNeedsReview} from '@/utils/operations-freshness';
import {apiRequest} from '@/lib/api/client';
const labels={normal_sales:'Normal Sales',rtc:'RTC Sales',wastage:'Wastage',book_stock:'Book Stock'};
export function ControlCentreView(){
 const [data,setData]=useState<ControlCentre|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const current=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  if(current.current&&!current.current.signal.aborted)return;
  const controller=new AbortController();current.current=controller;setLoading(true);setError('');
  try{const r=await apiRequest<ControlCentre>('/operations',{signal:controller.signal});if(controller.signal.aborted)return;if(r.success)setData(r.data);else setError(r.error);}
  finally{if(current.current===controller)current.current=null;if(!controller.signal.aborted)setLoading(false);}
 },[]);
 useEffect(()=>{
  void refresh();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
  return()=>{current.current?.abort();current.current=null;clearInterval(timer);};
 },[refresh]);
 return <div className="space-y-6">
  <div className="flex flex-wrap gap-3"><button onClick={()=>void refresh()} disabled={loading} className="rounded border bg-white px-4 py-2">{loading?'Checking stores…':'Refresh store overview'}</button><Link href="/data-quality" className="rounded bg-emerald-700 px-4 py-2 text-white">Review data quality</Link><Link href="/orders" className="rounded border bg-white px-4 py-2">Order history</Link><a href="/api/data-operations/diagnostics" className="rounded border bg-white px-4 py-2">Download diagnostic log</a></div>
  {error?<p role="alert">Unable to load store overview: {error} Check the PostgreSQL connection and prepared office migrations.</p>:null}
  {data?<><p className="text-sm text-zinc-600">London business date {data.businessDate} · Checked {new Date(data.generatedAt).toLocaleTimeString('en-GB')} · Pending means a draft needs Excel preparation or regeneration; no order has been sent.</p>
   <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.stores.map(store=>{
    const missing=store.feeds.some(f=>!f.latest_data_date),outdated=store.feeds.some(f=>reportNeedsReview(f.source_type,f.latest_data_date,data.businessDate));
    const failed=store.feeds.some(f=>f.status==='failed');const bad=!store.configured||!store.active||missing||failed;const review=outdated||store.qualityIssues>0;
    return <section key={store.code} aria-label={`${store.name} operations`} className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">{store.name} <span className="text-xs text-zinc-500">{store.code}</span></h2><span className={`rounded px-2 py-1 text-xs ${bad?'bg-red-100 text-red-800':review?'bg-amber-100 text-amber-900':'bg-emerald-100 text-emerald-800'}`}>{bad?'Action required':review?'Review needed':'Ready'}</span></div>
     {!store.configured||!store.active?<p className="mt-2 text-sm text-red-700">{!store.configured?'Store is not configured.':'Store is inactive.'} Review the store catalogue.</p>:null}
     <dl className="mt-3 space-y-2 text-sm">{store.feeds.map(feed=><div key={feed.source_type} className="flex justify-between gap-3"><dt>{labels[feed.source_type]}</dt><dd className="text-right"><span>{feed.latest_data_date??'Missing report'}</span><div className="text-xs text-zinc-500">{feed.latest_data_updated_at?new Date(feed.latest_data_updated_at).toLocaleString('en-GB'):'Never imported'}{feed.status==='failed'?' · Import failed':''}</div></dd></div>)}</dl>
     {outdated?<p className="mt-2 text-xs text-amber-800">Outdated reports: verify movement feeds through yesterday and refresh Book Stock manually.</p>:null}
     <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p>Orders today: <strong>{store.ordersToday}</strong></p><p>Pending supplier drafts: <strong>{store.pendingSupplierOrders}</strong></p></div>
     <Link className="mt-3 block text-sm text-blue-700 underline" href={`/data-quality${store.id?`?storeId=${store.id}`:''}`}>{store.missingMappings} missing mappings · {store.missingPrices} missing prices · {store.qualityIssues} findings</Link>
    </section>;
   })}</div></>:null}
  <DataOperationsStatus />
 </div>;
}
