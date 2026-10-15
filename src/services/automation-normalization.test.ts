import { describe, expect, it } from 'vitest';
import { normalizeReport } from '../../automation/normalize-report';
import { previewOrderItem } from '@/utils/order-item-edit';
import type { OrderSheetItem } from '@/types/orderSheet';

const request={source:'normal_sales',start:'2026-10-15',end:'2026-10-15',erp:'msp' as const,fileName:'report.csv'};
describe('office parser adapter',()=>{
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
