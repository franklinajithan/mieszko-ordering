import {describe,it,expect} from 'vitest';
import {groupValidationIssues} from './validation-review';
import type {ValidationIssue} from '@/types/operations';
const issue=(itemCode:string,storeId:number,code:string,severity:ValidationIssue['severity']):ValidationIssue=>({itemCode,storeId,code,severity,message:code,action:'Review',href:'/supplier-prices'});
describe('product review grouping',()=>{
 it('groups all reasons for one store/item and retains separate stores',()=>{
  const result=groupValidationIssues([issue('A',1,'case_size','warning'),issue('A',2,'case_size','warning'),issue('A',1,'missing_mapping','blocking')]);
  expect(result).toHaveLength(2);expect(result[0]).toMatchObject({key:'1:A',severity:'blocking'});expect(result[0].issues.map(issue=>issue.code)).toEqual(['case_size','missing_mapping']);
 });
 it('keeps order-wide information separate and below blocking products',()=>{
  const info={...issue('',1,'excluded_zero','info'),itemCode:undefined};
  expect(groupValidationIssues([info,issue('A',1,'missing_quote','blocking')]).map(group=>group.severity)).toEqual(['blocking','info']);
 });
});
