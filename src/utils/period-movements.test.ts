import {describe,it,expect} from 'vitest';
import {readPeriodMovements} from './period-movements';
describe('saved comparison-period movements',()=>{
 it('reads exact saved totals in period order including zero and fractional quantities',()=>{
  expect(readPeriodMovements({orderSheet:{periodRtc:['0.0000','1.2500'],periodWastage:['2.5000','0.0000']}},2)).toEqual({periodRtc:['0.0000','1.2500'],periodWastage:['2.5000','0.0000']});
 });
 it('does not present disabled feeds as measured zero activity',()=>{
  expect(readPeriodMovements({orderSheet:{includeRtc:false,includeWastage:false,periodRtc:['0'],periodWastage:['0']}},1)).toEqual({});
 });
 it.each([null,{}, {orderSheet:{rtcQty:'2.0000'}},{orderSheet:{periodRtc:['1.0000'],periodWastage:['bad','3']}}])('does not invent zero totals for historical or invalid snapshots',breakdown=>{
  expect(readPeriodMovements(breakdown,2)).toEqual({});
 });
});
