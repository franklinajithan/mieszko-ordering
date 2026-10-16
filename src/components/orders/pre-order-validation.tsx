'use client';
import Link from 'next/link';
import type {OrderValidation} from '@/types/operations';
export function PreOrderValidation({report,acknowledged,onAcknowledge}:{report:OrderValidation;acknowledged:boolean;onAcknowledge:(value:boolean)=>void}){
 return <section aria-label="Pre-order validation" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
  <h3 className="font-semibold">Pre-order validation</h3><p>{report.blockingCount} blocking issues · {report.warningCount} warnings</p>
  <p className="text-sm">Correct blocking problems before creating supplier Excel files. Review warnings explicitly. Zero-quantity products are excluded; no supplier order is sent.</p>
  <div className="max-h-80 overflow-auto"><ul className="space-y-2">{report.issues.map((i,index)=><li key={`${i.code}-${i.storeId}-${i.itemCode}-${index}`} className="rounded bg-white p-2 text-sm"><strong className={i.severity==='blocking'?'text-red-800':i.severity==='warning'?'text-amber-900':'text-zinc-600'}>{i.severity.toUpperCase()}</strong> · {i.message} <Link className="text-blue-700 underline" href={i.href}>{i.action}</Link></li>)}</ul></div>
  {report.warningCount>0?<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={e=>onAcknowledge(e.target.checked)} />I have reviewed the warnings and confirm the quantities and retained data for this export.</label>:<p className="text-sm">No warnings requiring acknowledgement.</p>}
 </section>;
}
