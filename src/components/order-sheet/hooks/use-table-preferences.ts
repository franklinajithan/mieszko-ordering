'use client';
import {useState,useSyncExternalStore} from 'react';
const key='mieszko-order-table-v1';
function subscribe(callback:()=>void){window.addEventListener('storage',callback);window.addEventListener('mieszko-table-preferences',callback);return()=>{window.removeEventListener('storage',callback);window.removeEventListener('mieszko-table-preferences',callback);};}
function snapshot(){try{return window.localStorage.getItem(key)??'{}';}catch{return '{}';}}
type Preferences={gridVersion:number;store:string;supplier:string;onlySuggested:boolean;onlySelected:boolean;pageSize:number};
const defaults:Preferences={gridVersion:2,store:'',supplier:'',onlySuggested:false,onlySelected:false,pageSize:0};
export function parseTablePreferences(raw:string):Preferences {
 try{const parsed=JSON.parse(raw);return {gridVersion:2,store:typeof parsed.store==='string'?parsed.store:'',supplier:typeof parsed.supplier==='string'?parsed.supplier:'',onlySuggested:parsed.onlySuggested===true,onlySelected:parsed.onlySelected===true,pageSize:parsed.gridVersion===2&&[0,50,100,200,500,1000].includes(parsed.pageSize)?parsed.pageSize:0};}catch{return defaults;}
}
export function useTablePreferences(){
 const stored=useSyncExternalStore(subscribe,snapshot,()=> '{}');const [fallback,setFallback]=useState<string|null>(null);const value=parseTablePreferences(fallback??stored);
 function update(patch:Partial<Preferences>){const next=JSON.stringify({...value,...patch});try{window.localStorage.setItem(key,next);setFallback(null);window.dispatchEvent(new Event('mieszko-table-preferences'));}catch{setFallback(next);}}
 return [value,update] as const;
}
