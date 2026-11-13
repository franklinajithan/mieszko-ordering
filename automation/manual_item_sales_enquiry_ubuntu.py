#!/usr/bin/env python3
"""Manual Ubuntu downloader: CRM Report 6 (Item Sales Enquiry), one store at a time."""
import csv
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

STORES = {
    "Hounslow": "http://86.144.199.85:1900/",
    "Streatham": "http://81.145.169.202:1910/",
    "Gravesend": "http://195.99.114.73:1500/",
    "Watford": "http://82.31.127.26:1351/",
    "Eastham": "http://89.242.12.106:1391/",
    "Hayes": "http://86.151.248.88:1910/",
    "Perivale": "http://81.149.230.245:1900/",
}
ROOT = Path(__file__).resolve().parents[1] / "Item Sales Enquiry Reports"
BARCODE = "190955"

def dates_from_user():
    while True:
        try:
            start = datetime.strptime(input("From (DD/MM/YYYY): ").strip(), "%d/%m/%Y")
            end = datetime.strptime(input("To   (DD/MM/YYYY): ").strip(), "%d/%m/%Y")
            if end < start:
                print("End date must be after start date.")
                continue
            return [start + timedelta(days=i) for i in range((end-start).days + 1)]
        except ValueError:
            print("Use DD/MM/YYYY.")

def destination(store, day):
    folder = ROOT / store
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{store}_Item_Sales_Enquiry_{day:%d-%m-%Y}.xlsx"

def valid_xlsx(path):
    if not path.is_file() or not path.stat().st_size:
        return False
    try:
        with zipfile.ZipFile(path) as z:
            return "xl/workbook.xml" in z.namelist() and z.testzip() is None
    except (OSError, zipfile.BadZipFile):
        return False

def convert_excel(src, dest):
    if valid_xlsx(src):
        src.replace(dest)
        return
    if not shutil.which("libreoffice"):
        raise RuntimeError("LibreOffice missing: sudo apt install libreoffice")
    with tempfile.TemporaryDirectory() as td:
        folder = Path(td)
        profile = (folder / "lo-profile").resolve().as_uri()
        proc = subprocess.run([
            "libreoffice", f"-env:UserInstallation={profile}",
            "--headless", "--convert-to", "xlsx:Calc MS Excel 2007 XML",
            "--outdir", str(folder), str(src.resolve())
        ], capture_output=True, text=True, timeout=120)
        converted = folder / (src.stem + ".xlsx")
        if proc.returncode or not valid_xlsx(converted):
            raise RuntimeError(f"Excel conversion failed: {proc.stdout} {proc.stderr}")
        shutil.copy2(converted, dest)
    src.unlink(missing_ok=True)

def visible(locator):
    for i in range(locator.count()):
        try:
            if locator.nth(i).is_visible():
                return locator.nth(i)
        except Exception:
            pass
    return None

def explorer_frame(page):
    for frame in page.frames:
        try:
            body = frame.locator("body").inner_text(timeout=2500)
            if "Report List" in body and "Selected Report" in body:
                return frame
        except Exception:
            pass
    return None

def login(page, store, url):
    page.goto(url, wait_until="commit", timeout=60000)
    barcode = page.get_by_placeholder("Barcode")
    barcode.wait_for(state="visible", timeout=20000)
    barcode.fill(BARCODE)
    barcode.press("Enter")
    page.get_by_text(re.compile(r"^REPORTS$", re.I)).first.wait_for(timeout=30000)
    print(f"[{store}] Logged in")

def prepare(page, store, url):
    login(page, store, url)
    frame = explorer_frame(page)
    if frame is None:
        reports = visible(page.get_by_text(re.compile(r"^REPORTS$", re.I)))
        if reports is None:
            raise RuntimeError("Reports menu missing")
        reports.hover(force=True)
        page.wait_for_timeout(1200)
        link = visible(page.get_by_text(re.compile(r"^EXPLORER$", re.I)))
        if link:
            link.click(force=True)
        else:
            page.evaluate("""() => {
                const a = [...document.querySelectorAll('a')].find(x =>
                  (x.textContent || '').trim().toLowerCase() === 'explorer' &&
                  (x.getAttribute('href') || '').toLowerCase().includes('commonreportexplorer'));
                if (a) a.click();
            }""")
        for _ in range(20):
            frame = explorer_frame(page)
            if frame:
                break
            page.wait_for_timeout(1000)
    if frame is None:
        raise RuntimeError("Report Explorer not found")

    report = visible(frame.get_by_text(re.compile(r"^\\s*6\\.\\s*Item\\s+Sales\\s+Enquiry\\s*$", re.I)))
    if report is None:
        sales = visible(frame.get_by_text("Sales", exact=True))
        if sales:
            sales.click(force=True)
            page.wait_for_timeout(1000)
        report = visible(frame.get_by_text(re.compile(r"^\\s*6\\.\\s*Item\\s+Sales\\s+Enquiry\\s*$", re.I)))
    if report is None:
        raise RuntimeError("Report 6 not found")
    report.click(force=True)
    page.wait_for_timeout(1000)

    radio = visible(frame.get_by_label("Date Range", exact=True))
    if radio:
        radio.check(force=True)
    else:
        label = visible(frame.get_by_text("Date Range", exact=True))
        if label is None:
            raise RuntimeError("Date Range control missing")
        parent_radio = label.locator("xpath=..").locator('input[type="radio"]')
        if not parent_radio.count():
            raise RuntimeError("Date Range radio missing")
        parent_radio.first.check(force=True)
    return frame

def date_fields(frame):
    frm = visible(frame.get_by_label("From Date", exact=False))
    to = visible(frame.get_by_label("To Date", exact=False))
    if frm and to:
        return frm, to
    matches = []
    inputs = frame.locator('input[type="text"]')
    for i in range(inputs.count()):
        item = inputs.nth(i)
        try:
            if item.is_visible() and re.fullmatch(r"\\d{2}/\\d{2}/\\d{4}", item.input_value().strip()):
                matches.append(item)
        except Exception:
            pass
    if len(matches) < 2:
        raise RuntimeError("Date input fields missing")
    return matches[-2], matches[-1]

def set_day(frame, page, day):
    value = day.strftime("%d/%m/%Y")
    frm, to = date_fields(frame)
    for item in (frm, to):
        item.fill(value)
        item.press("Tab")
        page.wait_for_timeout(350)
        if item.input_value().strip() != value:
            item.evaluate("""(el, value) => {
                el.value = value;
                el.dispatchEvent(new Event('input', {bubbles:true}));
                el.dispatchEvent(new Event('change', {bubbles:true}));
                el.blur();
            }""", value)
        if item.input_value().strip() != value:
            raise RuntimeError("Date field did not retain " + value)

def find_export(page, selectors):
    for frame in page.frames:
        for selector in selectors:
            item = visible(frame.locator(selector))
            if item:
                return item
    return None

def download(context, page, frame, store, day):
    dest = destination(store, day)
    if valid_xlsx(dest):
        return "skipped"
    set_day(frame, page, day)
    with context.expect_page(timeout=30000) as popup:
        frame.locator("#lnkView").click(force=True)
    report_page = popup.value
    try:
        report_page.wait_for_timeout(5000)
        export = find_export(report_page, [
            "#rptViewer_ctl05_ctl04_ctl00_ButtonLink",
            '[title*="Export"]', '[alt*="Export"]',
            'img[title*="Export"]', 'a[title*="Export"]',
        ])
        if export is None:
            raise RuntimeError("Report export button not found")
        export.click(force=True)
        report_page.wait_for_timeout(800)
        excel = find_export(report_page, [
            'a[title="Excel"]', 'a[onclick*="EXCELOPENXML"]',
        ])
        if excel is None:
            for f in report_page.frames:
                excel = visible(f.get_by_text("Excel", exact=True))
                if excel:
                    break
        if excel is None:
            raise RuntimeError("Excel export menu item not found")
        with report_page.expect_download(timeout=180000) as dl:
            excel.click(force=True)
        item = dl.value
        if item.failure():
            raise RuntimeError("Browser download failed: " + str(item.failure()))
        with tempfile.TemporaryDirectory() as td:
            ext = ".xlsx" if item.suggested_filename.lower().endswith(".xlsx") else ".xls"
            src = Path(td) / ("report" + ext)
            item.save_as(str(src))
            if not src.stat().st_size:
                raise RuntimeError("Empty downloaded report")
            convert_excel(src, dest)
        return "downloaded"
    finally:
        report_page.close()

def main():
    dates = dates_from_user()
    print(f"Stores: {len(STORES)}; days: {len(dates)}; reports: {len(STORES)*len(dates)}")
    print(f"Output: {ROOT}")
    if input("Press ENTER to run, or Q to cancel: ").strip().lower() == "q":
        return
    results = {"downloaded": 0, "skipped": 0, "failed": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        try:
            for idx, (store, url) in enumerate(STORES.items(), 1):
                print(f"\n=== STORE {idx}/{len(STORES)}: {store} ===", flush=True)
                pending = [d for d in dates if not valid_xlsx(destination(store, d))]
                results["skipped"] += len(dates) - len(pending)
                if not pending:
                    print("All reports already exist")
                    continue
                for day in pending:
                    last_error = None
                    for attempt in range(1, 3):
                        context = browser.new_context(accept_downloads=True, ignore_https_errors=True)
                        try:
                            page = context.new_page()
                            frame = prepare(page, store, url)
                            result = download(context, page, frame, store, day)
                            results[result] += 1
                            print(f"[{result.upper()}] {store} {day:%d/%m/%Y}", flush=True)
                            last_error = None
                            break
                        except Exception as exc:
                            last_error = str(exc)
                            print(f"[RETRY {attempt}/2] {store} {day:%d/%m/%Y}: {exc}", flush=True)
                        finally:
                            context.close()
                    if last_error:
                        results["failed"].append((store, day, last_error))
        finally:
            browser.close()
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / "failed_reports.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Store", "Date", "Error"])
        writer.writerows((s, d.strftime("%d/%m/%Y"), err) for s, d, err in results["failed"])
    print(f"\nFinished. Downloaded: {results['downloaded']}; skipped: {results['skipped']}; failed: {len(results['failed'])}")
    print("Output:", ROOT)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped by user")
