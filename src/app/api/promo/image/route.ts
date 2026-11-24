import { mkdir,readFile,writeFile,rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const runtime="nodejs";
const dir=()=>process.env.PROMO_IMAGE_DIR||path.join(process.cwd(),"data","promo-images");
const valid=(s:string)=>/^\d{1,32}\.webp$/.test(s);
export async function GET(req:Request){const name=new URL(req.url).searchParams.get("name")||"";if(!valid(name))return new Response(null,{status:400});try{return new Response(new Uint8Array(await readFile(path.join(dir(),name))),{headers:{"Content-Type":"image/webp","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}catch{return new Response(null,{status:404})}}
export async function POST(req:Request){const form=await req.formData();const files=form.getAll("files");if(files.length>100)return Response.json({error:"Upload at most 100 files per request"},{status:400});await mkdir(dir(),{recursive:true});const saved:string[]=[],failed:string[]=[];for(const f of files){if(!(f instanceof File))continue;const name=f.name.toLowerCase();if(!valid(name)||f.size>5000000){failed.push(name);continue;}const bytes=Buffer.from(await f.arrayBuffer());if(bytes.toString("ascii",0,4)!=="RIFF"||bytes.toString("ascii",8,12)!=="WEBP"){failed.push(name);continue;}const temp=path.join(dir(),randomUUID()+".tmp");await writeFile(temp,bytes);await rename(temp,path.join(dir(),name));saved.push(name);}return Response.json({saved,failed});}
