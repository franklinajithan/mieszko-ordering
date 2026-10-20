/** Reuse application parsers for unattended office imports; never opens a database. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseDailySalesFileBuffer, detectSalesColumns } from '../src/parsers/daily-sales/daily-sales-file-parser';
import { parseRtcFileBuffer } from '../src/parsers/rtc/rtc-file-parser';
import { parseWastageFileBuffer } from '../src/parsers/wastage/wastage-file-parser';
import { parseBookStockFileBuffer } from '../src/parsers/book-stock/book-stock-file-parser';
import { detectBookStockColumns } from '../src/parsers/file-parser';
import { prepareDailySalesImport } from '../src/services/daily-sales/daily-sales-import-prepare';
import { isIsoDateString } from '../src/utils/iso-date';

export async function normalizeReport(input:{buffer:Buffer;fileName:string;source:string;start:string;end:string;erp:'msp'|'glopos';includeReviewMetadata?:boolean}) {
  if (!isIsoDateString(input.start)||!isIsoDateString(input.end)||input.start>input.end) throw new Error('Invalid requested dates');
  if (input.source==='normal_sales') {
    const parsed=await parseDailySalesFileBuffer(input.buffer,input.fileName);
    const detected=detectSalesColumns(parsed.headers);
    if (!parsed.productColumn||!parsed.quantityColumn) throw new Error('Sales report columns not detected');
    const prepared=prepareDailySalesImport({productColumn:parsed.productColumn,quantityColumn:parsed.quantityColumn,dateColumn:detected.dateColumn??undefined,
      manualSalesDate:parsed.manualSalesDate??(!detected.dateColumn&&input.start===input.end?input.start:undefined),rows:parsed.rows});
    if (prepared.result.invalidRows) throw new Error(`Sales report has ${prepared.result.invalidRows} invalid rows`);
    if (prepared.sales.some(row=>!isIsoDateString(row.salesDate)||row.salesDate<input.start||row.salesDate>input.end)) throw new Error('Report dates differ from requested dates');
    return {source:input.source,mapping_type:'store_product_code',...(input.includeReviewMetadata?{product_descriptions:Object.fromEntries(prepared.sales.filter(row=>row.productName).map(row=>[row.reference,row.productName]))}:{}),rows:prepared.sales.map(row=>({Code:row.reference,Date:row.salesDate,Qty:row.qty.toString()}))};
  }
  if (input.start!==input.end) throw new Error('RTC, Wastage and Book Stock normalization requires one daily report per job');
  const parsed=input.source==='rtc'?await parseRtcFileBuffer(input.buffer,input.fileName,input.erp):input.source==='wastage'?await parseWastageFileBuffer(input.buffer,input.fileName,input.erp):input.source==='book_stock'?await parseBookStockFileBuffer(input.buffer,input.fileName):null;
  if (!parsed) throw new Error('Unknown report source');
  const detected=detectBookStockColumns(parsed.headers,input.erp);
  const reference=parsed.referenceColumn??detected.referenceColumn;
  const quantity=parsed.quantityColumn??detected.quantityColumn;
  if (!reference||!quantity) throw new Error('Report columns not detected');
  const reportDate='rtcDate' in parsed?parsed.rtcDate:'wastageDate' in parsed?parsed.wastageDate:'bookStockDate' in parsed?parsed.bookStockDate:null;
  if (reportDate && reportDate!==input.start) throw new Error('Report date differs from requested date');
  return {source:input.source,...(input.includeReviewMetadata?{product_descriptions:Object.fromEntries(parsed.rows.filter(row=>row.__productName).map(row=>[row[reference],row.__productName]))}:{}),mapping_type:'barcodeMapped' in parsed&&parsed.barcodeMapped?'barcode':'store_product_code',rows:parsed.rows.map(row=>{
    const dateColumn=parsed.headers.find(header=>/^(?:(?:rtc|wastage|sales|stock)\s*)?date$/i.test(header));
    const day=dateColumn?row[dateColumn]:input.start;
    if (day && day!==input.start) throw new Error('Report row date differs from requested date');
    return {Code:row[reference],Date:input.start,Qty:row[quantity]};
  })};
}

async function main() {
  const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'},source:{type:'string'},start:{type:'string'},end:{type:'string'},erp:{type:'string',default:'msp'}}});
  if (!values.input||!values.output||!values.source||!values.start||!values.end||!['msp','glopos'].includes(values.erp!)) throw new Error('Required: --input --output --source --start --end --erp msp|glopos');
  const result=await normalizeReport({buffer:await readFile(values.input),fileName:path.basename(values.input),source:values.source,start:values.start,end:values.end,erp:values.erp as 'msp'|'glopos',includeReviewMetadata:true});
  await writeFile(values.output,JSON.stringify(result),'utf8');
}
if (process.argv[1] && path.basename(process.argv[1])==='normalize-report.ts') void main().catch(error=>{console.error(error instanceof Error?error.message:'Normalization failed');process.exitCode=1;});
