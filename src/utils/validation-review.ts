import type {ValidationIssue} from '@/types/operations';
export const validationLabels:Record<string,string>={missing_quote:'No valid supplier quote',missing_mapping:'Supplier code changed',invalid_price:'Price missing or changed',case_size:'Check case size',manual_review:'Supplier comparison',manual_quantity:'Manual quantity',inactive_supplier:'Inactive supplier',inactive_product:'Inactive product',invalid_quantity:'Invalid quantity',excluded_zero:'Zero quantities excluded',missing_crm:'Missing reports',outdated_crm:'Report date needs review',partial_import:'Unmatched products',failed_import:'Import failed',empty_order:'No quantities to order',delivery_date:'Invalid delivery date'};
const rank={blocking:0,warning:1,info:2};
export function groupValidationIssues(issues:ValidationIssue[]){
 const groups=new Map<string,{key:string;itemCode?:string;productName?:string;storeName?:string;supplierName?:string;severity:ValidationIssue['severity'];issues:ValidationIssue[]}>();
 for(const issue of issues){
  const key=issue.itemCode?`${issue.storeId??''}:${issue.itemCode}`:`general:${issue.storeId??''}:${issue.code}`;
  const group=groups.get(key)??{key,itemCode:issue.itemCode,productName:issue.productName,storeName:issue.storeName,supplierName:issue.supplierName,severity:issue.severity,issues:[]};
  if(rank[issue.severity]<rank[group.severity])group.severity=issue.severity;
  group.issues.push(issue);groups.set(key,group);
 }
 return [...groups.values()].sort((a,b)=>rank[a.severity]-rank[b.severity]);
}
