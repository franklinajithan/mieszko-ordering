import * as XLSX from 'xlsx';
import {parse} from 'papaparse';
import {detectRtcColumns} from '@/parsers/file-parser';
import {isIsoDateString} from '@/utils/iso-date';

export type RtcReportIdentity = {date?:string;storeName?:string;storeNames?:string[];storeCode?:string};

/** Validate the original report before parsers discard its title and identity. */
export function inspectRtcReport(buffer:ArrayBuffer|Buffer,fileName:string,erp:'msp'|'glopos',identity?:RtcReportIdentity) {
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
  const prefix=bytes.subarray(0,1000).toString();
  if(/<(?:form|input)\b|password|sign in|log in/i.test(prefix))throw new Error('Downloaded RTC file is a login page');
  if(/\.xlsx?$/i.test(fileName)&&!(bytes.subarray(0,2).toString()==='PK'||bytes.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1'||/<(?:html|table|\?xml|Workbook)\b/i.test(prefix)))throw new Error('Unreadable RTC workbook; previous data retained');
  let grid:string[][];
  if(/\.csv$/i.test(fileName))grid=parse<string[]>(bytes.toString(),{skipEmptyLines:true}).data;
  else {
    const workbook=XLSX.read(bytes,{type:'buffer',cellDates:true});
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet)throw new Error('RTC workbook has no worksheets');
    if(Object.entries(sheet).some(([key,cell])=>!key.startsWith('!')&&cell.t==='e'))throw new Error('RTC report contains an Excel cell error');
    grid=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:false}).map(row=>row.map(value=>String(value??'').trim()));
  }
  const text=grid.flat().join(' ');
  if(/password|sign in|log in/i.test(text))throw new Error('Downloaded RTC file is a login page');
  const header=grid.findIndex(row=>{const d=detectRtcColumns(row,erp);if(!d.referenceColumn)d.referenceColumn=row.find(cell=>/^(?:ean|barcode)$/i.test(cell))??null;return !!d.referenceColumn&&!!d.quantityColumn&&d.referenceColumn!==d.quantityColumn;});
  const metadata=(header<0?grid:grid.slice(0,header)).flat().join(' ');
  const days=grid.filter(row=>row.some(cell=>/^\s*(?:date(?:\s*range)?|day)\s*:/i.test(cell))&&!/created|printed|generated/i.test(row.join(' ')))
    .flatMap(row=>[...row.join(' ').matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)]
      .map(m=>m[1]?`${m[1]}-${m[2]}-${m[3]}`:`${m[6]}-${m[5].padStart(2,'0')}-${m[4].padStart(2,'0')}`));
  if(days.some(day=>!isIsoDateString(day))||new Set(days).size>1)throw new Error('RTC report must cover one valid day');
  if(identity?.date&&days[0]&&identity.date!==days[0])throw new Error('Report date differs from requested date');
  const escape=(name:string)=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(identity?.storeNames?.some(name=>new RegExp(`\\b${escape(name)}\\b`,'i').test(metadata)&&name.toLowerCase()!==identity.storeName?.toLowerCase()))throw new Error('Report contains another store');
  const codes:Record<string,string>={HNS:'0365',PVL:'0766',EAS:'0650',HYS:'0665',GRV:'0566',WTF:'0602',STR:'0388'};
  const code=(value:string)=>codes[value.toUpperCase()]??value;
  if(identity?.storeCode&&[...metadata.matchAll(/\b(?:store|branch)\s*(?:code)?\s*[:=-]\s*([A-Z]{3}|\d{4})\b/gi)].some(m=>code(m[1])!==code(identity.storeCode!)))throw new Error('Report contains another store');
  if(header>=0&&identity){
    const column=grid[header].findIndex(cell=>/^(?:store|branch)(?:\s*(?:code|name))?$/i.test(cell));
    if(column>=0&&grid.slice(header+1).some(row=>row[column]&&row[column].toLowerCase()!==identity.storeName?.toLowerCase()&&code(row[column])!==code(identity.storeCode??'')))throw new Error('Report contains another store');
  }
  const empty=(row:string[])=>row.every(cell=>!cell||/^no records available[.!]?$/i.test(cell));
  const footer=(row:string[])=>{const values=row.filter(Boolean);return /^(?:created|printed|generated)\b/i.test(values[0]??'')||/^(?:grand\s*)?total(?:s|\s*[:=-])?$/i.test(values[0]??'')&&values.slice(1).every(cell=>/^[-+]?0(?:[.,]0+)?$/.test(cell));};
  const noRecords=grid.some(row=>row.some(cell=>/^no records available[.!]?$/i.test(cell)));
  const headerOnly=header>=0&&grid.slice(header+1).every(row=>empty(row)||footer(row));
  if(noRecords||headerOnly){
    if(grid.flat().some(cell=>!/\brtc\b|reduce|clear/i.test(cell)&&/sold\s*(?:qty|quantity)|sales\s*(?:qty|quantity)|wastage\s*(?:qty|quantity)|current\s*stock|book\s*stock/i.test(cell)))throw new Error('Empty file is not a recognized RTC report');
    if(!/\brtc\b|reduce\s*to\s*clear|price\s*override/i.test(metadata)&&/unit\s*price|net\s*price/i.test(text))throw new Error('Empty file is not a recognized RTC report');
    if(/wastage|stock\s*adjustment|normal\s*sales|book\s*stock|stock\s*valuation|supplier\s*price/i.test(text)||(!headerOnly&&!/\brtc\b|reduce\s*to\s*clear|price\s*override/i.test(text)))throw new Error('Empty file is not a recognized RTC report');
    if(noRecords&&header>=0&&!headerOnly)throw new Error('RTC report contains conflicting data and empty markers');
    // Headerless CRM empty layouts must identify their business day. Created On is not that day.
    if(noRecords&&header<0&&!days.length)throw new Error('Empty RTC report has no business date');
    if(noRecords&&header<0){
      const marker=grid.findIndex(row=>row.some(cell=>/^no records available[.!]?$/i.test(cell)));
      if(grid.slice(marker+1).some(row=>!empty(row)&&!footer(row)))throw new Error('RTC report contains conflicting data and empty markers');
      if(grid.slice(0,marker).some(row=>!/(?:date|day)\s*(?:range)?\s*:|created|printed|generated|\brtc\b|price\s*override|\b(?:store|branch)\b/i.test(row.join(' '))&&row.some(cell=>/^[-+]?\d+(?:[.,]\d+)?$/.test(cell))))throw new Error('RTC report contains conflicting data and empty markers');
    }
    return {emptyReport:true as const,rtcDate:days[0]};
  }
  return null;
}
