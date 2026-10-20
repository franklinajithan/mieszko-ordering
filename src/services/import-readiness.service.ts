import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { listDatesInclusive } from '@/utils/orderSheetCalculations';
const feeds={normal_sales:{table:'daily_sales',date:'sales_date',label:'Normal Sales'},rtc:{table:'rtc_sales',date:'rtc_date',label:'RTC Sales'},wastage:{table:'wastage',date:'wastage_date',label:'Wastage'}} as const;
export async function getImportCoverage(input:{storeIds:number[];comparisonPeriods:Array<{startDate:string;endDate:string}>;includeRtc?:boolean;includeWastage?:boolean;dayBySalesRequired?:boolean;dayBySalesStartDate?:string;dayBySalesEndDate?:string}) {
  const comparisonDates=new Set(input.comparisonPeriods.flatMap(period=>listDatesInclusive(period.startDate,period.endDate)));
  if (!comparisonDates.size || !input.storeIds.length) return {coverage:[],warnings:[]};
  const enabled=(['normal_sales',...(input.includeRtc?['rtc']:[]),...(input.includeWastage?['wastage']:[])] as Array<keyof typeof feeds>);
  const coverage=await Promise.all(enabled.map(async source=>{
    const dates=new Set(comparisonDates);
    if(source==="normal_sales"&&input.dayBySalesRequired&&input.dayBySalesStartDate&&input.dayBySalesEndDate)for(const day of listDatesInclusive(input.dayBySalesStartDate,input.dayBySalesEndDate))dates.add(day);
    const sorted=[...dates].sort();
    const feed=feeds[source];
    const rows=await db.execute(sql`SELECT sp.store_id, f.${sql.identifier(feed.date)}::text AS business_date, max(f.updated_at) AS updated_at
      FROM ${sql.identifier(feed.table)} f JOIN store_products sp ON sp.id=f.store_product_id
      WHERE sp.store_id IN (${sql.join(input.storeIds.map(id=>sql`${id}`),sql`,`)})
        AND f.${sql.identifier(feed.date)} BETWEEN ${sorted[0]}::date AND ${sorted.at(-1)}::date
      GROUP BY sp.store_id,f.${sql.identifier(feed.date)}`);
    const partial:Array<{storeId:number;date:string}>=[];
    const present=new Set(rows.map(row=>`${row.store_id}:${row.business_date}`));
    // A verified successful zero-row report is distinct from a missing import.
    // Keep the data-table checks usable even before the audit migration is applied.
    try {
      const runs=await db.execute(sql`SELECT store_id,source_start_date::text AS start,source_end_date::text AS finish
        FROM data_import_runs WHERE source_type=${source} AND status='success'
          AND store_id IN (${sql.join(input.storeIds.map(id=>sql`${id}`),sql`,`)})
          AND source_start_date<=${sorted.at(-1)}::date AND source_end_date>=${sorted[0]}::date`);
      for (const run of runs) for (const day of dates) if (day>=String(run.start)&&day<=String(run.finish)) present.add(`${run.store_id}:${day}`);
      const incomplete=await db.execute(sql`SELECT store_id,report_date::text AS day FROM crm_partial_publications
        WHERE source_type=${source} AND store_id IN (${sql.join(input.storeIds.map(id=>sql`${id}`),sql`,`)})
        AND report_date BETWEEN ${sorted[0]}::date AND ${sorted.at(-1)}::date`);
      for(const row of incomplete)if(dates.has(String(row.day))){present.delete(`${row.store_id}:${row.day}`);partial.push({storeId:Number(row.store_id),date:String(row.day)});}
    } catch (error) {
      const cause=error as {code?:string;cause?:{code?:string}};
      if ((cause.code??cause.cause?.code)!=='42P01') throw error;
    }
    const missing=input.storeIds.flatMap(storeId=>[...dates].filter(day=>!present.has(`${storeId}:${day}`)).map(day=>({storeId,date:day})));
    return {source,label:feed.label,expectedStoreDays:dates.size*input.storeIds.length,availableStoreDays:dates.size*input.storeIds.length-missing.length,missing,partial};
  }));
  return {coverage,warnings:[...coverage.filter(row=>row.missing.length).map(row=>`${row.label}: no recorded activity or missing import for ${row.missing.length} store/date combinations (${row.missing.slice(0,4).map(item=>`store ${item.storeId} ${item.date}`).join(', ')}). Verify reports before using zero demand.`),...coverage.filter(row=>row.partial.length).map(row=>`${row.label}: ${row.partial.length} partial store/date reports contain saved matching rows but still have unmatched products. Quantities are incomplete; review Unmatched Products before relying on totals.`)]};
}
