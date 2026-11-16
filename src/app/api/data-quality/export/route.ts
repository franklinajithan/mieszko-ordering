import {NextResponse} from 'next/server';
import ExcelJS from 'exceljs';
import {apiError,route} from '@/lib/api/http';
import {getQualityIssues} from '@/services/operations/data-quality.service';
import {queryFilters} from '@/services/operations/filters';
export const GET=route(async request=>{
 const parsed=queryFilters(request);if(!parsed.success)return apiError('Invalid data quality filters');
 const {search,...filters}=parsed.data;let issues=await getQualityIssues(filters);
 if(search){const q=search.toLowerCase();issues=issues.filter(i=>[i.itemCode,i.productName,i.message,i.supplierName,i.storeName].some(v=>v?.toLowerCase().includes(q)));}
 if(issues.length>100000)return apiError('More than 100,000 findings. Narrow the filters before exporting.');
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Unresolved issues');
 sheet.addRow(['Store','Supplier','Problem','Severity','Item code','Product','Finding','Recommended action']);
 for(const i of issues)sheet.addRow([i.storeName,i.supplierName??'',i.type,i.severity,i.itemCode??'',i.productName??'',i.message,i.action]);
 sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.columns.forEach((c,index)=>c.width=index>=6?70:24);
 sheet.autoFilter='A1:H1';
 return new NextResponse(new Uint8Array(await book.xlsx.writeBuffer()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Mieszko-data-quality.xlsx"','Cache-Control':'no-store'}});
});
