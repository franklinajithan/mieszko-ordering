import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {parseRtcFileBuffer} from './rtc-file-parser';
import {normalizeReport} from '../../../automation/normalize-report';
const identity={date:'2026-10-20',storeName:'Eastham',storeCode:'0650',storeNames:['Eastham','Hayes']};
function bytes(rows:unknown[][],xls=false){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'VoidSaleHistory');return XLSX.write(book,{type:'buffer',bookType:xls?'biff8':'xlsx'}) as Buffer;}
// Mirrors the supplied Eastham export: no store or column headers, different creation day.
const empty=[[],['','','','','Price Override & RTC Sales History','','Created On :','','21/10/2026 13:07'],[],[],[],['','','','Date : 20-10-2026'],[],[],['','','No Records Available'],[]];
describe('validated zero RTC activity',()=>{
 it.each([false,true])('accepts the real CRM empty layout in XLSX/XLS (%s)',async xls=>{
  const buffer=bytes(empty,xls);const parsed=await parseRtcFileBuffer(buffer,'report.xlsx','msp',identity);
  expect(parsed).toMatchObject({emptyReport:true,rtcDate:'2026-10-20',rows:[]});
  expect(await normalizeReport({buffer,fileName:'report.xlsx',erp:'msp',source:'rtc',start:identity.date,end:identity.date,...identity})).toMatchObject({source:'rtc',rows:[],zero_activity_verified:true});
 });
 it.each([['EAN','Qty'],['Item Code','RTC Qty']])('accepts valid header-only RTC schema %s',async(a,b)=>{
  expect(await parseRtcFileBuffer(bytes([[a,b]]),'rtc.xlsx')).toMatchObject({emptyReport:true,rows:[]});
 });
 it.each(['Sold Qty','Wastage Qty','Current Stock','Unit Price'])('rejects unrelated header-only schema %s',async quantity=>{
  await expect(parseRtcFileBuffer(bytes([['Item Code',quantity]]),'report.xlsx')).rejects.toThrow('recognized RTC');
 });
 it('accepts a titled RTC header-only history with price columns',async()=>{
  expect(await parseRtcFileBuffer(bytes([['Price Override & RTC Sales History'],['Date: 20-10-2026'],['EAN','Qty','Unit Price']]),'rtc.xlsx')).toMatchObject({emptyReport:true});
 });
 it('rejects wrong business day while ignoring Created On',async()=>{
  await expect(parseRtcFileBuffer(bytes(empty),'rtc.xlsx','msp',{...identity,date:'2026-10-21'})).rejects.toThrow('date differs');
 });
 it.each(['Hayes','Store Code: 0665'])('rejects another store %s',async store=>{
  await expect(parseRtcFileBuffer(bytes([[store],...empty]),'rtc.xlsx','msp',identity)).rejects.toThrow('another store');
 });
 it.each(['Wastage','Normal Sales','Book Stock','Supplier Price'])('rejects unrelated empty %s reports',async title=>{
  await expect(parseRtcFileBuffer(bytes([[title],['Date: 20-10-2026'],['No Records Available']]),'report.xlsx','msp',identity)).rejects.toThrow('recognized RTC');
 });
 it.each(['corrupt file','<html><form><input type="password">No Records Available</form></html>'])('rejects unreadable/login content',async text=>{
  await expect(parseRtcFileBuffer(Buffer.from(text),'rtc.xlsx','msp',identity)).rejects.toThrow();
 });
 it('rejects contradictory empty markers and transactions',async()=>{
  await expect(parseRtcFileBuffer(bytes([['RTC'],['EAN','Qty'],['1234',2],['No Records Available']]),'rtc.xlsx')).rejects.toThrow('conflicting');
 });
 it('rejects unlabelled transaction rows before an empty marker',async()=>{
  await expect(parseRtcFileBuffer(bytes([['RTC'],['Date: 20-10-2026'],['12345',2],['No Records Available']]),'rtc.xlsx')).rejects.toThrow('conflicting');
 });
 it('requires the business date on a headerless empty report',async()=>{
  await expect(parseRtcFileBuffer(bytes([['RTC Created On : 21/10/2026'],['No Records Available']]),'rtc.xlsx')).rejects.toThrow('business date');
 });
});
