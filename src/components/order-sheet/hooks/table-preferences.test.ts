import {it,expect} from 'vitest';
import {parseTablePreferences} from './use-table-preferences';
it('migrates an earlier 200-row setting to the continuous worksheet',()=>{
 expect(parseTablePreferences(JSON.stringify({pageSize:200,store:'0365',supplier:'1',onlySelected:true}))).toMatchObject({gridVersion:2,pageSize:0,store:'0365',supplier:'1',onlySelected:true});
});
it('retains every explicitly chosen current worksheet page size including all rows',()=>{
 for(const pageSize of [0,50,100,200,500,1000])expect(parseTablePreferences(JSON.stringify({gridVersion:2,pageSize})).pageSize).toBe(pageSize);
});
it('uses all rows for invalid or unavailable preferences',()=>{
 for(const raw of ['invalid','null','{}',JSON.stringify({gridVersion:2,pageSize:-1})])expect(parseTablePreferences(raw).pageSize).toBe(0);
});
it('does not accept malformed filters from storage',()=>{
 expect(parseTablePreferences(JSON.stringify({gridVersion:2,store:2,supplier:[],onlySelected:'false',onlySuggested:'true'}))).toMatchObject({store:'',supplier:'',onlySelected:false,onlySuggested:false});
});
