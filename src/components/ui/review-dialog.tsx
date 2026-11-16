'use client';
import * as Dialog from '@radix-ui/react-dialog';
import {useRef,type ReactNode} from 'react';

/** Controlled review window with keyboard dismissal, focus trapping and restoration. */
export function ReviewDialog({open,onOpenChange,title,description,children,closeLabel='Close details'}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description:string;children:ReactNode;closeLabel?:string}){
 const previousFocus=useRef<HTMLElement|null>(null);
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
  <Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/50" />
  <Dialog.Content onOpenAutoFocus={()=>{previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;}} onCloseAutoFocus={event=>{event.preventDefault();if(previousFocus.current?.isConnected)previousFocus.current.focus();}} className="fixed left-1/2 top-1/2 z-[81] flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl">
   <header className="flex shrink-0 items-start justify-between gap-4 border-b bg-zinc-50 px-5 py-4"><div><Dialog.Title className="text-lg font-semibold text-zinc-900">{title}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-zinc-600">{description}</Dialog.Description></div><Dialog.Close aria-label={closeLabel} className="shrink-0 whitespace-nowrap rounded border bg-white px-3 py-1 text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-blue-600">Close ×</Dialog.Close></header>
   <div className="overflow-auto overscroll-contain p-5">{children}</div>
  </Dialog.Content>
 </Dialog.Portal></Dialog.Root>;
}
