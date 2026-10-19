import { describe, expect, it } from 'vitest';
import { normalizeReport } from '../../automation/normalize-report';
import { previewOrderItem } from '@/utils/order-item-edit';
import type { OrderSheetItem } from '@/types/orderSheet';
import ExcelJS from 'exceljs';

const request={source:'normal_sales',start:'2026-10-15',end:'2026-10-15',erp:'msp' as const,fileName:'report.csv'};
describe('office parser adapter',()=>{
  async function rtcHistory(options:{range?:string;scan?:string}={}) {
    const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('VoidSaleHistory');
    sheet.addRow(['Price Override & RTC Sales History']);
    sheet.addRow([`Date Range: ${options.range??'15-10-2026 to 15-10-2026'}`]);
    sheet.addRow(['EAN','Sale Description','Scanned Date','Qty','Reason']);
    sheet.addRow(['00001234','Weighted RTC product','15/10/2026 12:00','4.675','REDUCE TO CLEAR']);
    sheet.addRow(['00001234','Weighted RTC product',options.scan??'15/10/2026 13:00','0.805','REDUCE TO CLEAR']);
    sheet.addRow(['00005678','Ordinary price override','15/10/2026 13:00','100','PRICE OVERRIDE']);
    sheet.addRow(['','','','105.48','']);
    return {...request,source:'rtc',fileName:'rtc-history.xls',buffer:Buffer.from(await workbook.xlsx.writeBuffer())};
  }
  it('reads the RTC range and barcode, excludes ordinary overrides and adds weighted quantities exactly',async()=>{
    expect(await normalizeReport(await rtcHistory())).toEqual({source:'rtc',mapping_type:'barcode',rows:[
      {Code:'00001234',Date:'2026-10-15',Qty:'5.48'},
    ]});
  });
  it('rejects an RTC history file downloaded for a different job date',async()=>{
    await expect(normalizeReport({...await rtcHistory(),start:'2026-10-14',end:'2026-10-14'})).rejects.toThrow('date');
  });
  it.each(['16/10/2026 13:00','', '31/02/2026 13:00'])('rejects inconsistent or invalid scanned dates: %s',async scan=>{
    await expect(normalizeReport(await rtcHistory({scan}))).rejects.toThrow();
  });
  it('rejects a weekly RTC range passed to a daily job',async()=>{
    await expect(normalizeReport(await rtcHistory({range:'14-10-2026 to 15-10-2026'}))).rejects.toThrow();
  });
  it('aggregates weighted CRM report lines with exact decimal quantities and ignores report totals',async()=>{
    const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('ProductSalesEnquiry');
    sheet.addRow(['Item Sales Enquiry']);sheet.addRow(['Date Range: 15-10-2026 to 15-10-2026']);
    sheet.addRow(['Item Code','Description','Sales Qty']);
    sheet.addRow(['P001','Weighted product','4.675']);sheet.addRow(['P001','Weighted product, renamed','0.805']);
    sheet.addRow(['P002','Other product','0.1']);sheet.addRow(['P002','Other product','0.2']);
    sheet.addRow(['Normal Sales - Total :','','5.78']);sheet.addRow(['Grand Total :','','5.78']);
    const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
    const input={...request,fileName:'crm-report.xls',buffer};
    expect((await normalizeReport(input)).rows).toEqual([
      {Code:'P001',Date:'2026-10-15',Qty:'5.48'}, {Code:'P002',Date:'2026-10-15',Qty:'0.3'},
    ]);
    await expect(normalizeReport({...input,start:'2026-10-14',end:'2026-10-14'})).rejects.toThrow('dates');
  });
  it('normalizes daily sales without merging another movement feed',async()=>{
    const result=await normalizeReport({...request,buffer:Buffer.from('Item Code,Sales Date,Sold Qty\n0001,2026-10-15,3\n0001,2026-10-15,2\n')});
    expect(result.source).toBe('normal_sales');expect(result.rows).toEqual([{Code:'0001',Date:'2026-10-15',Qty:'5'}]);
  });
  it('rejects a report from the wrong date even for a single-day job',async()=>{
    await expect(normalizeReport({...request,buffer:Buffer.from('Item Code,Sales Date,Sold Qty\n0001,2026-10-14,3\n')})).rejects.toThrow('dates');
  });
  it('requires daily reports for RTC normalization',async()=>{
    await expect(normalizeReport({...request,source:'rtc',end:'2026-10-16',buffer:Buffer.from('')})).rejects.toThrow('one daily report');
  });
});
describe('live quantity and cost editing',()=>{
  const item={orderQty:'0',selected:false,cheapestNetPrice:'1.2345',estimatedLineCost:'0',suggestedOrderQty:'0'} as OrderSheetItem;
  it('selects a previously zero line and immediately computes decimal cost',()=>{
    expect(previewOrderItem(item,{orderQty:'12'})).toMatchObject({selected:true,estimatedLineCost:'14.8140',quantityOverridden:true});
  });
  it('shows zero total when deselected while retaining the editable quantity',()=>{
    expect(previewOrderItem({...item,orderQty:'12',selected:true},{selected:false})).toMatchObject({orderQty:'12',estimatedLineCost:'0.0000'});
  });
  it('keeps temporarily incomplete input editable without showing a false cost',()=>{
    expect(previewOrderItem(item,{orderQty:'2.'}).estimatedLineCost).toBeNull();
  });
});

it('detects an explicit sales barcode ahead of product name and preserves identifier type',async()=>{
 const result=await normalizeReport({...request,buffer:Buffer.from('Product Name,Barcode,Sales Date,Sold Qty\nMilk,00123456789012,2026-10-15,2\n')});
 expect(result.mapping_type).toBe('barcode');expect(result.rows).toEqual([{Code:'00123456789012',Date:'2026-10-15',Qty:'2'}]);
});
