import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { AppShell } from '@/components/layout/app-shell';
import { isIsoDateString } from '@/utils/iso-date';
export default async function OrderHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  const text=(key:string)=>typeof params[key]==='string'?params[key] as string:'';
  const status=['draft','calculated'].includes(text('status'))?text('status'):'';
  const from=isIsoDateString(text('from'))?text('from'):'';
  const to=isIsoDateString(text('to'))?text('to'):'';
  const storeId=/^\d+$/.test(text('store'))?Number(text('store')):0;
  const page=Math.max(1,Math.min(10000,Math.floor(Number(text('page'))||1)));
  const [stores,rows]=await Promise.all([
    db.execute(sql`SELECT id,name FROM stores ORDER BY name`),
    db.execute(sql`SELECT o.id,o.order_date,o.delivery_date,o.status,o.comment,o.store_ids,
      count(i.id)::int AS lines,coalesce(sum(i.final_order_qty),0)::text AS units,
      coalesce(sum(i.estimated_line_cost),0)::text AS net_total,
      count(i.id) FILTER (WHERE i.final_order_qty>0 AND i.price_status <> 'complete')::int AS price_checks,
      count(*) OVER()::int AS total_orders
      FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
      WHERE (${status}='' OR o.status=${status}) AND (${from}='' OR o.order_date>=nullif(${from},'')::date)
        AND (${to}='' OR o.order_date<=nullif(${to},'')::date)
        AND (${storeId}=0 OR o.store_ids @> ${JSON.stringify([storeId])}::jsonb)
      GROUP BY o.id ORDER BY o.created_at DESC,o.id DESC LIMIT 50 OFFSET ${(page-1)*50}`),
  ]);
  const storeName=new Map(stores.map(store=>[Number(store.id),String(store.name)]));
  const pageLink=(next:number)=>{const query=new URLSearchParams({status,from,to,store:storeId?String(storeId):'',page:String(next)});return `/orders?${query}`;};
  return <AppShell title="Order history" description="Find saved orders, reopen quantities and generate supplier Excel files.">
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
        <label className="text-sm">Store<select name="store" defaultValue={storeId||''} className="block rounded border p-2"><option value="">All stores</option>{stores.map(store=><option key={Number(store.id)} value={Number(store.id)}>{String(store.name)}</option>)}</select></label>
        <label className="text-sm">Status<select name="status" defaultValue={status} className="block rounded border p-2"><option value="">All statuses</option><option value="draft">Draft</option><option value="calculated">Calculated</option></select></label>
        <label className="text-sm">From<input type="date" name="from" defaultValue={from} className="block rounded border p-2" /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={to} className="block rounded border p-2" /></label>
        <button className="rounded bg-blue-700 px-4 py-2 text-white">Filter</button><Link href="/orders" className="p-2 text-blue-700">Clear filters</Link><Link href="/order-sheet" className="ml-auto rounded border px-4 py-2">New order</Link>
      </form>
      <div className="overflow-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-zinc-50"><tr>{['Order','Stores','Order date','Delivery','Status','Lines / Units','Priced net value','Action'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr className="border-t" key={Number(row.id)}><td className="p-3">#{String(row.id)}</td><td className="p-3">{(row.store_ids as number[]).map(id=>storeName.get(id)??id).join(', ')}</td><td className="p-3">{String(row.order_date)}</td><td className="p-3">{String(row.delivery_date)}</td><td className="p-3">{String(row.status)}</td><td className="p-3">{String(row.lines)} / {Number(row.units).toLocaleString('en-GB')}</td><td className="p-3">£{Number(row.net_total).toFixed(2)}{Number(row.price_checks)>0?<span className="block text-xs text-amber-700">{String(row.price_checks)} price checks</span>:null}</td><td className="p-3"><Link className="text-blue-700 underline" href={`/orders/${row.id}`}>Reopen / export</Link></td></tr>)}</tbody></table>{!rows.length?<p className="p-6 text-zinc-500">No orders match these filters.</p>:null}</div>
      <nav aria-label="Order history pages" className="flex gap-4">{page>1?<Link href={pageLink(page-1)}>← Previous</Link>:null}<span>Page {page}</span>{Number(rows[0]?.total_orders)>page*50?<Link href={pageLink(page+1)}>Next →</Link>:null}</nav>
    </div>
  </AppShell>;
}
