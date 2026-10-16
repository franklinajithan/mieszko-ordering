'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {apiRequest} from '@/lib/api/client';
import {problemTypes,type QualityIssue} from '@/types/operations';
type Option={id:number;name:string};
export function DataQualityCentre({stores,suppliers,initialStoreId=''}:{stores:Option[];suppliers:Option[];initialStoreId?:string}){
 const [storeId,setStore]=useState(initialStoreId),[supplierId,setSupplier]=useState(''),[type,setType]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
 const [result,setResult]=useState<{issues:QualityIssue[];total:number;pageSize:number}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const query=new URLSearchParams({...storeId?{storeId}:{},...supplierId?{supplierId}:{},...type?{type}:{},...search?{search}:{},page:String(page)}).toString();
 useEffect(()=>{let alive=true;const timer=setTimeout(()=>{
  setLoading(true);setError('');void apiRequest<{issues:QualityIssue[];total:number;pageSize:number}>(`/data-quality?${query}`).then(r=>{if(!alive)return;if(r.success)setResult(r.data);else setError(r.error);setLoading(false);});
 },200);return()=>{alive=false;clearTimeout(timer);};},[query,refresh]);
 function resetPage(){setPage(1);}
 return <div className="space-y-4">
  <div className="flex flex-wrap items-end gap-3">
   <label className="text-sm">Store<select aria-label="Quality store" value={storeId} onChange={e=>{setStore(e.target.value);resetPage();}} className="block rounded border p-2"><option value="">All stores</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label className="text-sm">Supplier<select aria-label="Quality supplier" value={supplierId} onChange={e=>{setSupplier(e.target.value);resetPage();}} className="block rounded border p-2"><option value="">All suppliers</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label className="text-sm">Problem<select aria-label="Problem type" value={type} onChange={e=>{setType(e.target.value);resetPage();}} className="block rounded border p-2"><option value="">All problems</option>{problemTypes.map(t=><option key={t} value={t}>{t.replaceAll('_',' ')}</option>)}</select></label>
   <label className="flex-1 text-sm">Search findings<input aria-label="Search findings" value={search} onChange={e=>{setSearch(e.target.value);resetPage();}} className="block w-full rounded border p-2" placeholder="Item code, product, store or finding" /></label>
   <button onClick={()=>setRefresh(n=>n+1)} disabled={loading} className="rounded border bg-white p-2">Refresh findings</button>
   <a href={`/api/data-quality/export?${query}`} className="rounded bg-emerald-700 p-2 text-white">Export unresolved issues</a>
  </div>
  <p className="text-sm text-zinc-600">Findings are read-only. Possible duplicates require review; no identities are merged and no prices are estimated. Products marked unavailable from a supplier are excluded from missing-code warnings. Supplier filters show supplier-specific findings.</p>
  {loading?<p role="status">Checking data quality…</p>:null}{error?<p role="alert">Unable to check data quality: {error}</p>:null}
  {result?<><p aria-live="polite">{result.total.toLocaleString('en-GB')} unresolved findings · Page {page}</p><div className="overflow-auto rounded-xl border bg-white"><table className="min-w-[950px] w-full text-left text-sm"><thead className="bg-zinc-50"><tr>{['Store','Supplier','Problem','Item / product','Finding','Action'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{result.issues.map(i=><tr key={i.id} className="border-t"><td className="p-3">{i.storeName}</td><td className="p-3">{i.supplierName??'—'}</td><td className="p-3"><span className={i.severity==='error'?'text-red-700':'text-amber-800'}>{i.type.replaceAll('_',' ')}</span></td><td className="p-3">{i.itemCode??'—'}<div>{i.productName}</div></td><td className="max-w-sm p-3">{i.message}</td><td className="max-w-sm p-3"><Link className="text-blue-700 underline" href={i.href}>{i.action}</Link></td></tr>)}</tbody></table>{!result.issues.length?<p className="p-6">No findings match these filters.</p>:null}</div><div className="flex gap-3"><button disabled={loading||page===1} onClick={()=>setPage(p=>p-1)} className="rounded border p-2">Previous findings</button><button disabled={loading||page*result.pageSize>=result.total} onClick={()=>setPage(p=>p+1)} className="rounded border p-2">Next findings</button></div></>:null}
 </div>;
}
