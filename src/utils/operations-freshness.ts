/** London calendar policy: movement reports through yesterday, manually refreshed stock today. */
export function requiredReportDate(source:string,businessDate:string){
 if(source==='book_stock')return businessDate;
 const date=new Date(`${businessDate}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);
}
export function reportNeedsReview(source:string,lastDate:string|null,businessDate:string){return !lastDate||lastDate<requiredReportDate(source,businessDate);}
