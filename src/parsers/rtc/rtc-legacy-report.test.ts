import {describe,expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {normalizeReport} from '../../../automation/normalize-report';

function report(type:XLSX.BookType='biff8',scan='20/10/2026 13:00') {
 const book=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([
  ['Price Override & RTC Sales History'],['Mieszko Hayes'],['Date : 20-10-2026'],
  ['EAN','Sale Description','Scanned Date','Qty','Reason'],
  ['00001234','Weighted RTC','20/10/2026 12:00','4.675','REDUCE TO CLEAR'],
  ['00001234','Weighted RTC',scan,'0.805','REDUCE TO CLEAR'],
  ['00005678','Ordinary price override','20/10/2026 13:00',100,'PRICE OVERRIDE'],
  ['','','',105.48,''],
 ]);XLSX.utils.book_append_sheet(book,sheet,'Report');
 return XLSX.write(book,{type:'buffer',bookType:type}) as Buffer;
}
const input={fileName:'report.xlsx',source:'rtc',start:'2026-10-20',end:'2026-10-20',erp:'msp' as const};
describe('RTC Excel exports use actual bytes rather than the saved extension',()=>{
 it.each(['biff8','xlsx','html'] as const)('normalizes %s report headers below metadata and retains exact weighted totals',async type=>{
  expect(await normalizeReport({...input,buffer:report(type)})).toEqual({source:'rtc',mapping_type:'barcode',rows:[{Code:'00001234',Date:'2026-10-20',Qty:'5.48'}]});
 });
 it.each(['biff8','html'] as const)('rejects another report day in %s',async type=>{
  await expect(normalizeReport({...input,start:'2026-10-19',end:'2026-10-19',buffer:report(type)})).rejects.toThrow('date differs');
 });
 it.each(['biff8','html'] as const)('rejects an inconsistent transaction date in %s',async type=>{
  await expect(normalizeReport({...input,buffer:report(type,'21/10/2026 13:00')})).rejects.toThrow('date differs');
 });
 it('preserves numeric EAN zero padding and native Excel scanned dates',async()=>{
  const book=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([
   ['Date: 20-10-2026'],['EAN','Sale Description','Scanned Date','Qty'],
   [1234,'Milk',new Date('2026-10-20T12:00:00Z'),2],
  ]);sheet.A3.z='00000000';XLSX.utils.book_append_sheet(book,sheet,'RTC');
  expect((await normalizeReport({...input,buffer:XLSX.write(book,{type:'buffer',bookType:'biff8'})})).rows).toEqual([{Code:'00001234',Date:'2026-10-20',Qty:'2'}]);
 });
 it.each([Buffer.from('unreadable'),Buffer.from('<html><form><input type="password"></form></html>'),Buffer.alloc(0)])('rejects unreadable or login content',async buffer=>{
  await expect(normalizeReport({...input,buffer})).rejects.toThrow();
 });
});
