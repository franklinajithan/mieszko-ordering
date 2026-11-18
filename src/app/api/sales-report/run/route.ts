import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const root="/home/backend/mieszko-daily-sales-reports";
const output=path.join(root,"output");
const state=path.join(root,"manual-run.json");
const script=path.join(root,"daily_sales_reports.py");
const python="/home/backend/mieszko-weekly-wastage/.worker-runtime/venv/bin/python";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const isAlive=(pid:number)=>{try{process.kill(pid,0);return true}catch{return false}};
async function status(){
 let run:{pid:number;date:string;startedAt:string}|null=null;
 try{run=JSON.parse(await readFile(state,"utf8"))}catch{}
 const active=!!run&&isAlive(run.pid);
 let log="";
 if(run){try{log=(await readFile(path.join(root,`manual-${run.date}.log`),"utf8")).slice(-24000)}catch{}}
 const completed=(log.match(/\[SUCCESS\]|\[SKIPPED\]/g)||[]).length;
 const failed=(log.match(/\[STORE ERROR\]/g)||[]).length;
 return {active,run,log,completed,failed};
}
export async function GET(){return NextResponse.json(await status())}
export async function POST(req:NextRequest){
 const origin=req.headers.get("origin");
 if(!origin||new URL(origin).host!==req.headers.get("host"))return NextResponse.json({error:"Invalid origin"},{status:403});
 const body=await req.json().catch(()=>null);
 const date=body?.date;
 if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+"T00:00:00Z").toISOString().slice(0,10)!==date)return NextResponse.json({error:"Invalid date"},{status:400});
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 const now=`${values.year}-${values.month}-${values.day}`;
 if(date>=now)return NextResponse.json({error:"Select a previous date"},{status:400});
 await mkdir(root,{recursive:true});
 const current=await status();
 if(current.active)return NextResponse.json({error:`A manual download for ${current.run?.date} is running`},{status:409});
 try{await readFile(script)}catch{return NextResponse.json({error:"Downloader is not installed on Ubuntu yet"},{status:503})}
 // systemd timer also runs this script; flock is shared with its service.
 const logfile=path.join(root,`manual-${date}.log`);
 const command=`exec 9>"${root}/run.lock"; flock -n 9 || { echo "Another sales report download is active"; exit 75; }; "${python}" -u "${script}" --date "${date}" >> "${logfile}" 2>&1`;
 const child=spawn("/bin/bash",["-c",command],{cwd:root,detached:true,stdio:"ignore"});
 if(!child.pid)return NextResponse.json({error:"Unable to start download"},{status:500});
 await writeFile(state,JSON.stringify({pid:child.pid,date,startedAt:new Date().toISOString()}));
 child.unref();
 return NextResponse.json({started:true,date,pid:child.pid},{status:202});
}
