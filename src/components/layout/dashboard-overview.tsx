import Link from 'next/link';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

async function loadOverview() {
  try {
    // Each feed is aggregated separately: joining raw movement rows multiplies totals.
    const [totals, recent] = await Promise.all([
      db.execute(sql`SELECT
        (SELECT count(*) FROM stores WHERE is_active=true)::int AS stores,
        (SELECT count(*) FROM products WHERE is_active=true)::int AS products,
        (SELECT count(*) FROM crm_partial_publications WHERE report_date >= (now() AT TIME ZONE 'Europe/London')::date-6 AND report_date <= (now() AT TIME ZONE 'Europe/London')::date)::int AS partial_reports,
        (SELECT coalesce(sum(sold_qty),0)::text FROM daily_sales WHERE sales_date >= (now() AT TIME ZONE 'Europe/London')::date-6 AND sales_date <= (now() AT TIME ZONE 'Europe/London')::date) AS normal_sales,
        (SELECT coalesce(sum(rtc_qty),0)::text FROM rtc_sales WHERE rtc_date >= (now() AT TIME ZONE 'Europe/London')::date-6 AND rtc_date <= (now() AT TIME ZONE 'Europe/London')::date) AS rtc,
        (SELECT coalesce(sum(wastage_qty),0)::text FROM wastage WHERE wastage_date >= (now() AT TIME ZONE 'Europe/London')::date-6 AND wastage_date <= (now() AT TIME ZONE 'Europe/London')::date) AS wastage`),
      db.execute(sql`SELECT o.id, o.order_date, o.delivery_date, o.status,
        count(i.id)::int AS lines, coalesce(sum(i.estimated_line_cost),0)::text AS cost,
        count(i.id) FILTER (WHERE i.final_order_qty>0 AND i.price_status <> 'complete')::int AS needs_price_check
        FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
        GROUP BY o.id ORDER BY o.created_at DESC LIMIT 12`),
    ]);
    return { totals, recent };
  } catch { return null; }
}
export async function DashboardOverview() {
  const data = await loadOverview();
  if (!data) return <p role="status" className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">Trading overview is unavailable. Check the database connection and pending migrations. No figures have been estimated.</p>;
  const {totals, recent} = data;
    const total = totals[0];
    return <section className="space-y-4" aria-label="Trading overview">
      <div><h3 className="text-lg font-semibold">Trading overview</h3><p className="text-xs text-zinc-500">Imported quantities for the last 7 calendar days, including today (London). Missing imports are not estimates.</p></div>
      <>{Number(total.partial_reports)>0&&<p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">{Number(total.partial_reports)} partial reports in these totals: matching rows are saved, but unmatched products remain. <Link className="underline" href="/unmatched-products">Review unmatched products</Link></p>}</><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[['Active stores',total.stores],['Active products',total.products],['Normal Sales units',total.normal_sales],['RTC Sales units',total.rtc],['Wastage units',total.wastage]].map(([label,value])=><div key={String(label)} className="rounded-xl border bg-white p-4"><p className="text-xs text-zinc-500">{String(label)}</p><p className="text-2xl font-semibold">{Number(value).toLocaleString('en-GB',{maximumFractionDigits:2})}</p></div>)}</div>
      <h3 className="font-semibold">Recent orders</h3>
      {recent.length ? <div className="overflow-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-zinc-50"><tr>{['Order','Order date','Delivery','Lines','Priced value','Review'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{recent.map(row=><tr key={Number(row.id)} className="border-t"><td className="p-3"><Link className="text-blue-700 underline" href={`/orders/${row.id}`}>#{String(row.id)}</Link></td><td className="p-3">{String(row.order_date)}</td><td className="p-3">{String(row.delivery_date)}</td><td className="p-3">{String(row.lines)}</td><td className="p-3">£{Number(row.cost).toFixed(2)}</td><td className="p-3">{Number(row.needs_price_check)>0?`${row.needs_price_check} price checks`:String(row.status)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-zinc-500">No saved orders yet.</p>}
    </section>;
}
