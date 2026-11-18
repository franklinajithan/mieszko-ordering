#!/usr/bin/env python3
"""Download six Nebula reports for seven stores into one date-specific ZIP."""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, date
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZipFile, ZIP_DEFLATED
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright

ROOT=Path(os.getenv("MIESZKO_DAILY_REPORT_ROOT","/home/backend/mieszko-daily-sales-reports/output"))
BARCODE=os.getenv("MIESZKO_REPORT_BARCODE","190955")
STORES={
 "Hounslow":"http://86.144.199.85:1900/",
 "Streatham":"http://81.145.169.202:1910/",
 "Gravesend":"http://195.99.114.73:1500/",
 "Watford":"http://82.31.127.26:1351/",
 "Eastham":"http://89.242.12.106:1391/",
 "Hayes":"http://86.151.248.88:1910/",
 "Perivale":"http://81.149.230.245:1900/"
}
REPORTS=[
 ("Sales","15. Store Payment Summary","Sales_15_Store_Payment_Summary"),
 ("Sales","25. Till Payment Summary","Sales_25_Till_Payment_Summary"),
 ("Sales","13. Sales Summary (GP%)","Sales_13_Sales_Summary_GP"),
 ("Sales","5. Transactional Sales Report","Sales_05_Transactional_No_Sales"),
 ("History","1. Void Item History","History_01_Void_Item_History"),
 ("History","3. Price Override & RTC Sales History","History_03_Price_Override_RTC")
]
def pdf_ok(file):
 try:
  with file.open("rb") as f:
   if f.read(5)!=b"%PDF-":return False
   f.seek(max(0,file.stat().st_size-1024))
   return f.read().rstrip().endswith(b"%%EOF")
 except OSError:return False
def save_pdf(download,target):
 if download.failure():raise RuntimeError(download.failure())
 target.parent.mkdir(parents=True,exist_ok=True)
 with NamedTemporaryFile(dir=target.parent,suffix=".part",delete=False) as f:temp=Path(f.name)
 try:
  download.save_as(str(temp))
  if not pdf_ok(temp):raise RuntimeError("Incomplete or invalid PDF")
  temp.replace(target)
 finally:temp.unlink(missing_ok=True)
def explorer(page):
 for attempt in range(5):
  for frame in page.frames:
   try:
    if "Report List" in frame.locator("body").inner_text(timeout=1500) and "Selected Report" in frame.locator("body").inner_text(timeout=1500):return frame
   except Exception:pass
  for name in ("REPORTS","EXPLORER"):
   for item in page.get_by_text(re.compile("^"+name+"$",re.I)).all():
    try:
     if item.is_visible():
      if name=="REPORTS":item.hover(force=True)
      else:item.click(force=True)
      break
    except Exception:pass
  page.wait_for_timeout(2000)
 raise RuntimeError("Nebula Report Explorer not available")
def choose(frame,category,title):
 items=frame.get_by_text(title,exact=True)
 if not items.count():
  frame.get_by_text(category,exact=True).first.click()
  items=frame.get_by_text(title,exact=True)
 items.first.click(timeout=15000)
 frame.get_by_text(re.compile("Selected Report:",re.I)).first.wait_for(timeout=20000)
def set_day(frame,day):
 radios=frame.get_by_label("Date Range",exact=True)
 if radios.count():radios.first.check(force=True)
 else:
  label=frame.get_by_text("Date Range",exact=True).first
  label.locator("xpath=..").locator('input[type="radio"]').first.check(force=True)
 value=day.strftime("%d/%m/%Y")
 inputs=frame.locator('input[type="text"]')
 dates=[]
 for inp in inputs.all():
  try:
   if inp.is_visible() and re.fullmatch(r"\d\d/\d\d/\d{4}",inp.input_value().strip()):dates.append(inp)
  except Exception:pass
 if len(dates)<2:raise RuntimeError("Date fields not found")
 for inp in dates[-2:]:
  inp.fill(value);inp.press("Tab")
  if inp.input_value().strip()!=value:raise RuntimeError("Date value did not stick")
def pdf_export(page,frames,target):
 for frame in frames:
  for item in frame.get_by_role("button",name=re.compile(r"^(PDF|Export PDF|Export to PDF|Download PDF)$",re.I)).or_(frame.get_by_role("link",name=re.compile(r"^(PDF|Export PDF|Export to PDF|Download PDF)$",re.I))).all():
   try:
    if item.is_visible():
     with page.expect_download(timeout=180000) as d:item.click()
     save_pdf(d.value,target);return
   except Exception:raise
 raise RuntimeError("PDF export control not found")
def export(context,page,frame,stem,target):
 if stem.startswith("Sales_05_"):
  for sel in frame.locator("select").all():
   try:
    sel.select_option(label="No Sales",timeout=1000);break
   except Exception:pass
  search=frame.get_by_role("button",name="Search Sale",exact=True)
  if not search.count():search=frame.get_by_text("Search Sale",exact=True)
  downloads=[];popups=[]
  page.on("download",downloads.append);page.on("popup",popups.append)
  try:
   search.click()
   for _ in range(80):
    if downloads:save_pdf(downloads[0],target);return
    if popups:
     viewer=popups[0];viewer.wait_for_load_state("domcontentloaded",timeout=60000)
     pdf_export(viewer,viewer.frames,target);return
    try:pdf_export(page,[frame],target);return
    except RuntimeError:pass
    page.wait_for_timeout(750)
   raise RuntimeError("No PDF after Search Sale")
  finally:
   page.remove_listener("download",downloads.append);page.remove_listener("popup",popups.append)
   for popup in popups:
    if not popup.is_closed():popup.close()
 else:
  with context.expect_page(timeout=30000) as p:frame.locator("#lnkView").click()
  viewer=p.value
  try:
   viewer.wait_for_load_state("domcontentloaded",timeout=60000)
   viewer.wait_for_timeout(5000)
   pdf_export(viewer,viewer.frames,target)
  finally:viewer.close()
def process(browser,store,url,report,day):
 category,title,stem=report
 target=ROOT/day.isoformat()/store/(stem+".pdf")
 if pdf_ok(target):
  print(f"[SKIPPED] {store} | {title}",flush=True);return "SKIPPED",""
 last=""
 for attempt in range(1,4):
  context=browser.new_context(accept_downloads=True,ignore_https_errors=True,viewport={"width":1900,"height":900})
  context.set_default_timeout(20000)
  try:
   page=context.new_page()
   page.goto(url,wait_until="commit",timeout=60000)
   barcode=page.get_by_placeholder("Barcode")
   barcode.wait_for(state="visible",timeout=15000)
   barcode.fill(BARCODE);barcode.press("Enter")
   page.get_by_text(re.compile("^REPORTS$",re.I)).first.wait_for(state="visible",timeout=30000)
   frame=explorer(page);choose(frame,category,title)
   set_day(frame,day);export(context,page,frame,stem,target)
   print(f"[SUCCESS] {store} | {target.name}",flush=True);return "SUCCESS",""
  except Exception as exc:
   last=str(exc)
   print(f"[ATTEMPT {attempt}/3] {store} | {title} | {last[:250]}",flush=True)
  finally:context.close()
 return "FAILED",last
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--date",help="YYYY-MM-DD, default previous UK day")
 args=parser.parse_args()
 day=date.fromisoformat(args.date) if args.date else datetime.now(ZoneInfo("Europe/London")).date()-timedelta(days=1)
 if day>=datetime.now(ZoneInfo("Europe/London")).date():raise ValueError("Date must be in the past")
 print(f"Report date: {day.isoformat()} | 42 reports",flush=True)
 outcomes={}
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
  try:
   for store,url in STORES.items():
    print(f"{store} | Pass 1",flush=True)
    for report in REPORTS:outcomes[(store,report)]=process(browser,store,url,report,day)
   for store,url in STORES.items():
    failures=[r for r in REPORTS if outcomes[(store,r)][0]=="FAILED"]
    if failures:
     print(f"{store} | Pass 2",flush=True)
     for report in failures:outcomes[(store,report)]=process(browser,store,url,report,day)
  finally:browser.close()
 folder=ROOT/day.isoformat();folder.mkdir(parents=True,exist_ok=True)
 records=[{"store":s,"report":r[1],"status":result[0],"error":result[1]} for (s,r),result in outcomes.items()]
 failed=[r for r in records if r["status"]=="FAILED"]
 (folder/"failed_reports.txt").write_text("\n".join(f"{r['store']} | {r['report']} | {r['error']}" for r in failed))
 manifest={"report_date":day.isoformat(),"generated_at_uk":datetime.now(ZoneInfo("Europe/London")).isoformat(),"expected":42,"success":42-len(failed),"failed":len(failed),"complete":not failed,"reports":records}
 (folder/"manifest.json").write_text(json.dumps(manifest,indent=2))
 archive=ROOT/f"Mieszko_Sales_Reports_{day.isoformat()}.zip";tmp=archive.with_suffix(".zip.part")
 with ZipFile(tmp,"w",ZIP_DEFLATED) as zipfile:
  for item in sorted(folder.rglob("*")):
   if item.is_file():zipfile.write(item,item.relative_to(folder))
 tmp.replace(archive)
 print(f"Daily ZIP: {archive}",flush=True)
 print(f"Complete: {manifest['complete']} ({manifest['success']}/42)",flush=True)
 return 1 if failed else 0
if __name__=="__main__":
 try:sys.exit(main())
 except Exception as exc:
  print(f"FATAL ERROR: {exc}",file=sys.stderr,flush=True);sys.exit(1)
