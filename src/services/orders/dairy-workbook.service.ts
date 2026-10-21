import 'server-only';
import ExcelJS from 'exceljs';
import { orderRepository,storeRepository } from '@/repositories';
import { buildOrderSheetResult,settingsFromOrder } from '@/services/order-sheet.service';
import { getImportCoverage } from '@/services/import-readiness.service';
import { parseDbDecimal } from '@/utils/decimal';
import type { OrderSheetItem } from '@/types/orderSheet';
import { listDatesInclusive } from '@/utils/orderSheetCalculations';
import { InputError } from '@/utils/input-error';

const quantityFormat='#,##0.####;[Red]-#,##0.####;–';
const currencyFormat='"£"#,##0.00;[Red]-"£"#,##0.00;–';
const dayLabel=(iso:string)=>iso.split('-').reverse().join('.');
/** Native application export: the saved order remains the authority for forecast and final quantities. */
export async function exportDairyWorkbook(orderId:number) {
 const order=await orderRepository.getById(orderId);
 if(!order)throw new InputError('Order not found');
 const settings=settingsFromOrder(order);
 const [result,details,stores,coverage]=await Promise.all([
  buildOrderSheetResult(orderId),orderRepository.getOrderItemsWithDetails(orderId),
  Promise.all(order.storeIds.map(id=>storeRepository.getById(id))),getImportCoverage(settings),
 ]);
 const storeByProduct=new Map(details.map(row=>[row.storeProduct.id,row.storeProduct.storeId]));
 const workbook=new ExcelJS.Workbook();
 workbook.creator='Mieszko Ordering';workbook.calcProperties.fullCalcOnLoad=true;
 const dailyDates=settings.dayBySalesRequired&&settings.dayBySalesStartDate&&settings.dayBySalesEndDate?listDatesInclusive(settings.dayBySalesStartDate,settings.dayBySalesEndDate):[];
 const usedNames=new Set<string>();
 function uniqueName(label:string) {
  const base=label.replace(/[\\/*?:\[\]]/g,' ').replace(/^'+|'+$/g,'').trim().slice(0,27)||'Store';
  let name=base,index=1;
  while(usedNames.has(name.toLowerCase()))name=`${base.slice(0,26)} ${++index}`;
  usedNames.add(name.toLowerCase());return name;
 }
 function hasActivity(row:OrderSheetItem) {
  return [...row.periodSales,...row.dailySales,...(row.periodRtc??[]),...(row.periodWastage??[]),row.rtcQty,row.wastageQty,row.bookStockQty,row.receivedNotPostedQty,row.futureDeliveryQty,row.suggestedOrderQty,row.orderQty]
   .some(value=>!parseDbDecimal(value??'0').isZero());
 }
 const notes:Array<Array<string|number>>=[
  ['Order ID',orderId],['Order date',order.orderDate],['Delivery date',order.deliveryDate],['Saved order revision',order.revision],
  ['Sales calculation',settings.soldQtyMethod],['Book stock included',settings.includeBookStock?'Yes':'No'],
  ['RTC included',settings.includeRtc?'Yes':'No'],['Wastage included',settings.includeWastage?'Yes':'No'],
  ['Future deliveries included',settings.includeFutureDeliveries?'Yes':'No'],
  ['Shortfall periods',settings.shortfallPeriods.map(p=>`${p.startDate} to ${p.endDate}`).join('; ')],
  ['Comparison periods',settings.comparisonPeriods.map(p=>`${p.startDate} to ${p.endDate}`).join('; ')],
  ['Quantities','All quantities are units, including decimal / weighed quantities. Supplier prices are net unit prices.'],
  ['Calculations','Forecast, shortfall, demand, suggested and shop quantities use the saved order calculations. Changing Excel inputs does not rerun the dated stock simulation.'],
  ['Tabs','Product includes activity, stock, deliveries or a positive suggested/manual order. NO Movement contains the remaining zero-activity rows.'],
  ['Shop order quantity','Yellow cells can be edited in Excel; estimated line cost updates from that quantity. Excel edits do not update the saved application order.'],
  ['Missing supplier codes','A blank supplier code or price means it is unavailable in the saved supplier quote; it is not zero.'],
  ['Data coverage','Checks below describe report coverage at export time. Fix missing/partial reports and regenerate the order to update quantities.'],
  ...coverage.warnings.map(warning=>['Source warning',warning]),
 ];
 if(order.comment)notes.push(['Comment',order.comment]);
 const methodLabel=settings.soldQtyMethod==='max'?'Highest Sold Qty':settings.soldQtyMethod==='min'?'Lowest Sold Qty':'Average Sold Qty';
 for(const store of stores) {
  if(!store)continue;
  const rows=result.items.filter(row=>storeByProduct.get(row.storeProductId)===store.id)
   .sort((a,b)=>(a.departmentName??'').localeCompare(b.departmentName??'')||a.productName.localeCompare(b.productName)||a.itemCode.localeCompare(b.itemCode));
  const stockDate=settings.bookStockDatesByStore?.[store.id]??order.bookStockDate;
  const status=result.bookStockStatus.find(row=>row.storeId===store.id);
  notes.push(['Book stock check at export',`${store.name}: ${status?.message??'No stock status available'}`]);
  notes.push(['Store',`${store.name} (${store.code})`],['Stock snapshot used',settings.includeBookStock?stockDate:'Book stock excluded from this order']);
  for(const noMovement of [false,true]) {
   const label=noMovement?'NO Movement':'Product';
   const sheet=workbook.addWorksheet(uniqueName(stores.length===1?label:`${store.name} ${label}`));
   const headers=['ProductCode',...result.supplierColumns.map(s=>`${s.code} Code`),'InnerEan','ItemName1','ItemGroupName',
    ...result.comparisonPeriods.map(p=>`${dayLabel(p.startDate)}-${dayLabel(p.endDate)}`),...dailyDates,
    ...(settings.includeWastage?result.comparisonPeriods.map(p=>`Wastage ${dayLabel(p.startDate)}-${dayLabel(p.endDate)}`):[]),...(settings.includeRtc?result.comparisonPeriods.map(p=>`RTC ${dayLabel(p.startDate)}-${dayLabel(p.endDate)}`):[]),
    methodLabel,settings.includeRtc?'RTC':'RTC (not used)',settings.includeWastage?'Wastage':'Wastage (not used)',
    settings.includeBookStock?`Book Stock ${dayLabel(stockDate)}`:'Book Stock (not used)','Not Posted Delivery',
    'Book Stock with Delivery','Current Book Stock',settings.includeFutureDeliveries?'Future Delivery':'Future Delivery (not used)',
    'Forecast Sales','Shortfall','Projected Stock at Delivery','Demand for Shortfall Period','Order Qty','Shop Order Qty',
    ...result.supplierColumns.flatMap(s=>[`${s.code} Net Unit Price`,`${s.code} Case Size`]),'Cheapest Supplier','Cheapest Net Unit Price','Estimated Line Cost','Warning'];
   sheet.addRow(headers);sheet.views=[{state:'frozen',xSplit:1+result.supplierColumns.length+3,ySplit:1}];
   sheet.getRow(1).height=48;
   sheet.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF006B52'}};cell.alignment={vertical:'middle',wrapText:true};});
   const position=(header:string)=>headers.indexOf(header)+1;
   const salesStart=1+result.supplierColumns.length+4;
   for(const item of rows.filter(row=>hasActivity(row)!==noMovement)) {
    const quotes=result.supplierColumns.map(s=>item.supplierQuotes.find(q=>q.supplierId===s.supplierId));
    const values:ExcelJS.CellValue[]=[item.itemCode,...quotes.map(q=>q?.supplierProductCode??''),item.barcode??'',item.productName,item.departmentName??'',
     ...item.periodSales.map(Number),...item.dailySales.map(Number),...(settings.includeWastage?result.comparisonPeriods.map((_,index)=>item.periodWastage?.[index]==null?null:Number(item.periodWastage[index])):[]),...(settings.includeRtc?result.comparisonPeriods.map((_,index)=>item.periodRtc?.[index]==null?null:Number(item.periodRtc[index])):[]),Number(item.calculatedSoldQty),settings.includeRtc?Number(item.rtcQty):null,settings.includeWastage?Number(item.wastageQty):null,
     settings.includeBookStock?Number(item.bookStockQty??0):null,settings.includeBookStock?Number(item.receivedNotPostedQty??0):null,
     null,null,settings.includeFutureDeliveries?Number(item.futureDeliveryQty??0):null,
     Number(item.forecastMovementQty??0),Number(item.shortageQty??0),Number(item.projectedStockQty??0),item.coverageDemandQty==null?null:Number(item.coverageDemandQty),Number(item.suggestedOrderQty),Number(item.orderQty),
     ...quotes.flatMap(q=>[q?.netPrice==null?'':Number(q.netPrice),q?.caseSize??'']),
     item.supplierName??'',item.cheapestNetPrice==null?'':Number(item.cheapestNetPrice),item.estimatedLineCost==null?'':Number(item.estimatedLineCost),item.priceWarning??''];
    const row=sheet.addRow(values);
    const ref=(header:string)=>row.getCell(position(header)).address;
    if(settings.includeBookStock) {
     const book=headers.find(h=>h.startsWith('Book Stock '))!;
     row.getCell(position('Book Stock with Delivery')).value={formula:`SUM(${ref(book)},${ref('Not Posted Delivery')})`,result:Number(parseDbDecimal(item.bookStockQty??'0').plus(parseDbDecimal(item.receivedNotPostedQty??'0')))};
     row.getCell(position('Current Book Stock')).value={formula:`MAX(0,${ref('Book Stock with Delivery')})`,result:Math.max(0,Number(parseDbDecimal(item.bookStockQty??'0').plus(parseDbDecimal(item.receivedNotPostedQty??'0'))))};
    }
    if(result.comparisonPeriods.length) {
     const first=row.getCell(salesStart).address,last=row.getCell(salesStart+result.comparisonPeriods.length-1).address;
     const operation=settings.soldQtyMethod==='max'?'MAX':settings.soldQtyMethod==='min'?'MIN':'AVERAGE';
     row.getCell(position(methodLabel)).value={formula:`ROUND(${operation}(${first}:${last}),4)`,result:Number(item.calculatedSoldQty)};
    }
    const price=ref('Cheapest Net Unit Price'),quantity=ref('Shop Order Qty');
    row.getCell(position('Estimated Line Cost')).value={formula:`IF(${price}="","",ROUND(${quantity}*${price},4))`,result:item.estimatedLineCost==null?'':Number(item.estimatedLineCost)};
    row.getCell(position('Shop Order Qty')).dataValidation={type:'decimal',operator:'greaterThanOrEqual',formulae:[0],allowBlank:false,showErrorMessage:true,errorTitle:'Invalid quantity',error:'Enter a non-negative unit quantity.'};
    row.eachCell({includeEmpty:true},(cell,col)=>{
     if(col<salesStart)cell.numFmt='@';
     else cell.numFmt=quantityFormat;
     if(row.number%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F7F4'}};
     cell.alignment={vertical:'middle',wrapText:col===position('ItemName1')};
    });
    row.getCell(position('Shop Order Qty')).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF0B3'}};
    if(item.priceWarning)row.getCell(position('Warning')).font={color:{argb:'FF9C5700'}};
    row.height=36;
   }
   sheet.columns.forEach((column,index)=>{
    const header=headers[index];column.width=header==='ItemName1'?48:header==='Warning'?48:header==='ItemGroupName'?26:18;
    if(header.includes('Price'))column.numFmt='"£"#,##0.0000;[Red]-"£"#,##0.0000;–';
    if(header==='Estimated Line Cost')column.numFmt=currencyFormat;
    if(header.endsWith('Case Size')||header==='Cheapest Supplier'||header==='Warning')column.numFmt='General';
   });
   sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:headers.length}};
   sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'};
   sheet.headerFooter.oddHeader=`&L${store.name.replace(/&/g,'&&')}&COrder ${order.orderDate}&RDelivery ${order.deliveryDate}`;
   notes.push([`${store.name} ${label} rows`,sheet.rowCount-1]);
  }
 }
 const info=workbook.addWorksheet(uniqueName('Order details'));
 info.addRow(['Setting / source check','Value']);notes.forEach(row=>info.addRow(row));
 info.getRow(1).font={bold:true};info.columns=[{width:30},{width:110}];info.views=[{state:'frozen',ySplit:1}];
 info.eachRow(row=>{row.getCell(2).alignment={wrapText:true,vertical:'top'};row.height=Math.max(24,Math.ceil(row.getCell(2).text.length/95)*16);});
 const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
 const storeLabel=stores.length===1?(stores[0]?.name??'Store'):'Multi-store';
 return {base64:buffer.toString('base64'),fileName:`${storeLabel.replace(/[^a-zA-Z0-9 -]/g,'')} Dairy Order ${order.orderDate}.xlsx`};
}
