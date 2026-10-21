'use client';
import {useLayoutEffect,useRef,useState} from 'react';
export const ORDER_GRID_ROW_HEIGHT=80;
/** Window large worksheets while retaining every filtered row in the scroll range. */
export function useGridWindow(count:number,resetKey:string){
 const viewport=useRef<HTMLDivElement>(null);const header=useRef<HTMLTableSectionElement>(null);const pendingFocus=useRef<number|null>(null);
 const [scroll,setScroll]=useState({key:resetKey,top:0,height:600,headerHeight:112});
 const position=scroll.key===resetKey?scroll:{top:0,height:600,headerHeight:112};
 const virtual=count>200;
 const start=virtual?Math.min(Math.max(0,count-1),Math.max(0,Math.floor((position.top-position.headerHeight)/ORDER_GRID_ROW_HEIGHT)-8)):0;
 const end=virtual?Math.min(count,start+Math.ceil(position.height/ORDER_GRID_ROW_HEIGHT)+20):count;
 useLayoutEffect(()=>{if(viewport.current)viewport.current.scrollTop=0;},[resetKey]);
 useLayoutEffect(()=>{
  if(pendingFocus.current===null)return;
  const input=viewport.current?.querySelector<HTMLInputElement>(`input[data-order-index="${pendingFocus.current}"]`);
  if(input){input.focus();input.select();pendingFocus.current=null;}
 },[start,end]);
 function onScroll(){if(viewport.current)setScroll({key:resetKey,top:viewport.current.scrollTop,height:viewport.current.clientHeight,headerHeight:header.current?.offsetHeight??112});}
 function focusQuantity(index:number){
  if(index<0||index>=count)return;
  const input=viewport.current?.querySelector<HTMLInputElement>(`input[data-order-index="${index}"]`);
  if(input){input.focus();input.select();return;}
  if(viewport.current){pendingFocus.current=index;viewport.current.scrollTop=(header.current?.offsetHeight??112)+index*ORDER_GRID_ROW_HEIGHT;onScroll();}
 }
 return {viewport,header,onScroll,focusQuantity,start,end,virtual};
}
