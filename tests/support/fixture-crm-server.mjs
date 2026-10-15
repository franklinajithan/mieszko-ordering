// A deliberately offline fake CRM, used only by the Python downloader test.
import http from 'node:http';import {readFileSync} from 'node:fs';
const file=readFileSync(process.argv[2]);
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Type','text/html');
 if(req.url==='/download'){res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="BK.xlsx"');res.end(file);return;}
 if(req.url==='/reports'){res.end('<iframe id="report-frame" src="/frame"></iframe>');return;}
 if(req.url==='/frame'){res.end('<input id="from"><input id="to"><input id="negative" type="checkbox" checked><a id="excel" href="/download" download>Excel</a>');return;}
 res.end('<input id="username"><input id="password" type="password"><button id="login" onclick="document.querySelector(\'#reports\').hidden=false">Login</button><button id="reports" hidden onclick="window.open(\'/reports\')">Reports</button>');
});
server.listen(3200,'127.0.0.1',()=>console.log('FIXTURE_CRM_READY'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
