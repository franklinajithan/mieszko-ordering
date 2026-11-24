import { db } from "@/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import * as XLSX from "xlsx";
export const runtime="nodejs";
const code=z.string().regex(/^\d{1,32}$/);
const product=z.object({barcode:code,name:z.string().trim().min(1).max(500),brand:z.string().max(255),unit:z.string().min(1).max(30),weight:z.string().max(100)});
const label=product.extend({price:z.coerce.number().positive().max(99999).refine(n=>Math.abs(n*100-Math.round(n*100))<0.00001),period:z.string().trim().min(1).max(200)});
export async function GET(req:Request){try{
const barcode=new URL(req.url).searchParams.get("barcode");
if(barcode!==null){if(!code.safeParse(barcode).success)return Response.json({error:"Invalid barcode"},{status:400});
const saved=await db.execute(sql`select barcode,name,brand,unit,weight from promo_label_products where barcode=${barcode}`);
if(saved.length)return Response.json({product:saved[0]});
const found=await db.execute(sql`select distinct p.name from product_barcodes b join store_products s on s.id=b.store_product_id join products p on p.id=s.product_id where b.barcode=${barcode} and p.is_active and s.is_active order by p.name limit 2`);
return Response.json({product:found.length===1?{barcode,name:found[0].name,brand:"",unit:"EACH",weight:""}:null,ambiguous:found.length>1});}
return Response.json({history:await db.execute(sql`select id,created_at,labels from promo_label_batches order by id desc limit 100`)});
}catch{return Response.json({error:"Promo database unavailable; check migration."},{status:503})}}
export async function POST(req:Request){try{
let rows:unknown[];
if(req.headers.get("content-type")?.includes("multipart/form-data")){
const f=(await req.formData()).get("file");if(!(f instanceof File)||f.size>10000000)return Response.json({error:"Choose an Excel file under 10 MB"},{status:400});
const wb=XLSX.read(await f.arrayBuffer(),{type:"array"});const sheet=wb.Sheets[wb.SheetNames[0]];const data=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:false,defval:"",blankrows:false});
rows=data.filter((r,i)=>!(i===0&&String(r[0]).toLowerCase()==="barcode")).map(r=>({barcode:String(r[0]).trim(),brand:String(r[1]),unit:String(r[2]),weight:String(r[3]),name:String(r[4]),price:String(r[5]),period:String(r[7])}));
}else{rows=(await req.json()).labels;}
const parsed=z.array(label).min(1).max(5000).safeParse(rows);if(!parsed.success)return Response.json({error:"Invalid label rows",issues:parsed.error.issues},{status:400});
const seen=new Map<string,string>();const unique=parsed.data.filter(r=>{const key=JSON.stringify(r);if(seen.has(r.barcode)){if(seen.get(r.barcode)!==key)throw new Error("Conflicting duplicate barcode: "+r.barcode);return false;}seen.set(r.barcode,key);return true;});
await db.transaction(async tx=>{for(const r of unique)await tx.execute(sql`insert into promo_label_products(barcode,name,brand,unit,weight) values(${r.barcode},${r.name},${r.brand},${r.unit},${r.weight}) on conflict(barcode) do update set name=excluded.name,brand=excluded.brand,unit=excluded.unit,weight=excluded.weight`);await tx.execute(sql`insert into promo_label_batches(labels) values(${JSON.stringify(unique)}::jsonb)`);});
return Response.json({labels:unique,duplicates:parsed.data.length-unique.length});
}catch(e){return Response.json({error:e instanceof Error&&e.message.startsWith("Conflicting duplicate")?e.message:"Unable to save labels; check file and database migration."},{status:400})}}
