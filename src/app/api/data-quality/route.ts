import {apiError,apiOk,route} from '@/lib/api/http';
import {getQualityIssues} from '@/services/operations/data-quality.service';
import {queryFilters} from '@/services/operations/filters';
export const GET=route(async request=>{
 const parsed=queryFilters(request);if(!parsed.success)return apiError('Invalid data quality filters');
 const {search,page,...filters}=parsed.data;let issues=await getQualityIssues(filters);
 if(search){const q=search.toLowerCase();issues=issues.filter(i=>[i.itemCode,i.productName,i.message,i.supplierName,i.storeName].some(v=>v?.toLowerCase().includes(q)));}
 return apiOk({issues:issues.slice((page-1)*100,page*100),total:issues.length,page,pageSize:100,generatedAt:new Date().toISOString()});
});
