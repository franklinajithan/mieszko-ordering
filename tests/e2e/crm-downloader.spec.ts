import {test,expect} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import ExcelJS from 'exceljs';
test('offline CRM: login, popup, iframe, negative-stock control and Excel download',async()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'mieszko-crm-fixture-'));const original=path.join(folder,'source.xlsx');const output=path.join(folder,'BK.xlsx');
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Stock');sheet.addRow(['Item Code','Current Stock']);sheet.addRow(['10001',-3]);await book.xlsx.writeFile(original);
 const server=spawn(process.execPath,['tests/support/fixture-crm-server.mjs',original],{stdio:['ignore','pipe','inherit']});
 try{
  await new Promise<void>((resolve,reject)=>{server.stdout.on('data',data=>{if(String(data).includes('READY'))resolve();});server.once('error',reject);});
  const config=path.join(folder,'crm.json');
  writeFileSync(config,JSON.stringify({url:'http://127.0.0.1:3200',headless:true,timeout_ms:10000,browser_executable:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,browser_args:['--no-sandbox','--disable-dev-shm-usage'],login_steps:[{action:'fill',selector:'#username',env:'MIESZKO_FIXTURE_USER'},{action:'fill',selector:'#password',value:'fixture-only'},{action:'click',selector:'#login'}],reports:{book_stock:[{action:'popup',selector:'#reports',name:'reports'},{action:'fill',page:'reports',frame:'#report-frame',selector:'#from',value:'{start}'},{action:'fill',page:'reports',frame:'#report-frame',selector:'#to',value:'{end}'},{action:'check',page:'reports',frame:'#report-frame',selector:'#negative',checked:false},{action:'download',page:'reports',frame:'#report-frame',selector:'#excel'}]}}));
  execFileSync('python',['automation/crm_download.py','--config',config,'--source','book_stock','--start','2026-10-08','--end','2026-10-08','--output',output],{env:{...process.env,MIESZKO_FIXTURE_USER:'fixture-user'},timeout:25000});
  const received=new ExcelJS.Workbook();await received.xlsx.readFile(output);expect(received.worksheets[0].getRow(2).getCell(2).value).toBe(-3);
 }finally{server.kill('SIGTERM');}
});
