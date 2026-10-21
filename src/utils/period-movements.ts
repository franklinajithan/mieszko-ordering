/** Read saved period totals only. Historical orders must not acquire live movement data. */
export function readPeriodMovements(breakdown:unknown,periodCount:number):{periodRtc?:string[];periodWastage?:string[]}{
 const snapshot=breakdown&&typeof breakdown==='object'&&'orderSheet' in breakdown?breakdown.orderSheet:null;
 if(!snapshot||typeof snapshot!=='object')return {};
 const valid=(value:unknown):value is string[]=>Array.isArray(value)&&value.length===periodCount&&value.every(qty=>typeof qty==='string'&&/^-?\d+(?:\.\d+)?$/.test(qty));
 return {...(!('includeRtc' in snapshot&&snapshot.includeRtc===false)&&'periodRtc' in snapshot&&valid(snapshot.periodRtc)?{periodRtc:snapshot.periodRtc}:{}),...(!('includeWastage' in snapshot&&snapshot.includeWastage===false)&&'periodWastage' in snapshot&&valid(snapshot.periodWastage)?{periodWastage:snapshot.periodWastage}:{})};
}
