import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {normalizeReport} from '../../../automation/normalize-report';
const request={source:'wastage',erp:'msp' as const,fileName:'Hayes_Wastage_20261018.xls',start:'2026-10-18',end:'2026-10-18'};
function report(rows:unknown[][],bookType:'biff8'|'xlsx'='biff8'){
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Stock Adjustment');
 return XLSX.write(book,{type:'buffer',bookType});
}
const header=['Item Code','Item Name','Quantity','Adjustment Reason'];
describe('MSP Wastage recovery structures (synthetic, not live Hayes exports)',()=>{
 it.each(['biff8','xlsx'] as const)('accepts %s bytes, sparse metadata, thousands and exact weighted quantities',async format=>{
  const buffer=report([['Stock Adjustment'],['Date Range: 18/10/2026 to 18/10/2026'],[],header,['00012','Weighted item','0.1','Damaged'],['00012','Weighted item','0.2','Expired'],['X15','Other','1,234.5000','Damaged'],['X16','Excluded','2','Store Use'],[],['Grand Total','','1236.8']],format);
  const result=await normalizeReport({...request,buffer});
  expect(result.rows).toEqual([{Code:'00012',Date:request.start,Qty:'0.3'},{Code:'X15',Date:request.start,Qty:'1234.5'}]);
  expect(result).toMatchObject({wastage_reasons:{'00012':['Damaged','Expired']}});
 });
 it.each(['','NaN','1,25','-1','0.00001'])('fails the whole recognized report for Qty=%s',async qty=>{
  await expect(normalizeReport({...request,buffer:report([header,['P1','Valid','1','Damaged'],['P2','Invalid',qty,'Damaged']])})).rejects.toThrow(/row 3, Qty/);
 });
 it.each(['Day: 19/10/2026','Day: 31/02/2026','Date Range: 17/10/2026 to 18/10/2026'])('rejects conflicting or invalid date %s',async metadata=>{
  await expect(normalizeReport({...request,buffer:report([['Date: 18/10/2026'],header,['P1','Item','1','Damaged'],[metadata]])})).rejects.toThrow(/Date/);
 });
});

it('preserves the observed Hayes sparse WastageReport layout without treating Out of Date totals as dates',async()=>{
 const row=(code:unknown,ean:unknown,name:unknown,qty:unknown)=>['',code,'',ean,'',name,'','DAIRY','',qty,'',0,'','',0];
 const buffer=report([[],[],['','','','','','','Wastage','','','','Created On :','','','16/10/2026 16:37'],[],[],[],['','Store fixture\nDate Range: 18-10-2026 to 18-10-2026'],[],[],row('Item Code','EAN','Description','Qty'),['','Date : 18/10/2026'],['','Reason Code : 30  Reason Description : Damaged'],row('M0001',5901234560001,'Fixture product','0.1'),['','Total for Damaged :','','','','','','','','0.1'],['','Reason Code : 31 Reason Description : Out of Date'],row('M0001',5901234560001,'Fixture product','0.2'),['','Total for Out of Date :','','','','','','','','0.2'],['','Total for 18/10/2026 :','','','','','','','','0.3'],['','Grand Total :','','','','','','','','0.3']]);
 const result=await normalizeReport({...request,buffer});expect(result.rows).toEqual([{Code:'M0001',Date:request.start,Qty:'0.3'}]);expect(result).toMatchObject({wastage_reasons:{M0001:['Damaged','Out of Date']}});
});
