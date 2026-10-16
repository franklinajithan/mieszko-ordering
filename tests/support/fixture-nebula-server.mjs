// Offline replica of the supplied login/Explorer/date/export workflow. No office URLs.
import http from 'node:http';
import ExcelJS from 'exceljs';
const observed=[];
const labels={normal_sales:'Product Sales Enquiry',rtc:'Price Override & RTC Sales History',wastage:'9. Wastage'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:3201');res.setHeader('Content-Type','text/html');
 if(url.pathname==='/observed'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(observed));return;}
 if(url.pathname==='/download'){
  const source=url.searchParams.get('source'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
  if(!labels[source]||from!==to||!/^\d{2}\/\d{2}\/\d{4}$/.test(from)){res.statusCode=400;res.end('Invalid daily request');return;}
  observed.push({source,from,to});const day=from.split('/').reverse().join('-');
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Report');
  sheet.addRow(['Item Code',source==='normal_sales'?'Sold Qty':source==='rtc'?'RTC Qty':'Wastage Qty','Date']);
  sheet.addRow(['10001',source==='normal_sales'?4:source==='rtc'?1:0.5,day]);
  res.setHeader('Content-Type','application/vnd.ms-excel');res.setHeader('Content-Disposition','attachment; filename="report.xls"');
  res.end(Buffer.from(await book.xlsx.writeBuffer()));return;
 }
 if(url.pathname==='/report'){
  const popup=url.searchParams.get('source')==='rtc';
  res.end(`<button title="Export" onclick="document.querySelector('#excel').hidden=false">Export</button><a id="excel" hidden href="/download${url.search}" ${popup?`onclick="window.open(this.href);return false"`:'download'}>Excel</a>`);return;
 }
 if(url.pathname==='/explorer'){
  res.end(`<div>Report List</div><h2 id="selected">Selected Report: none</h2>
  <button>Sales</button><button>History</button><button>Stock</button>
  ${Object.entries(labels).map(([key,value])=>`<button onclick="choose('${key}')">${value}</button>`).join('')}
  <input type="radio" id="range" name="period" onchange="document.querySelectorAll('.date').forEach(e=>e.disabled=false)"><label for="range">Date Range</label>
  <input type="radio" id="week" name="period" checked><label for="week">Week</label>
  <label for="from">From Date*</label><input class="date" id="from" disabled>
  <label for="to">To Date*</label><input class="date" id="to" disabled>
  <a href="#" id="lnkView" onclick="window.open('/report?source='+source+'&from='+encodeURIComponent(document.querySelector('#from').value)+'&to='+encodeURIComponent(document.querySelector('#to').value));return false">View Report</a>
  <script>let source;const labels=${JSON.stringify(labels)};function choose(key){source=key;document.querySelector('#selected').textContent='Selected Report: '+labels[key];}</script>`);return;
 }
 const marker=url.pathname==='/wrong-store'?'0665':'0365';
 res.end(`<input placeholder="Barcode"><button onclick="document.querySelector('#main').hidden=false">Login</button>
 <div id="main" hidden><span>Store Info: ${marker} | Fixture</span><span>Reports</span><a href="#" onclick="document.querySelector('#frame').src='/explorer';return false">Explorer</a><iframe id="frame"></iframe></div>`);
});
server.listen(3201,'127.0.0.1',()=>console.log('FIXTURE_NEBULA_READY'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
