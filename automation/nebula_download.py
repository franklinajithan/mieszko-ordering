"""Daily Nebula report export, adapted from the supplied weekly Playwright flow.

No CRM records are edited. Login credentials come only from the local environment.
Actual office acceptance is still required; offline browser fixtures test the flow.
"""
import argparse
import getpass
import json
from datetime import date
import os
from pathlib import Path
import re
import sys
import threading
import time
from urllib.parse import urlsplit

REPORTS = {
    'normal_sales': ('Sales', 'Product Sales Enquiry'),
    'rtc': ('History', 'Price Override & RTC Sales History'),
    'wastage': ('Stock', 'Wastage'),
}

# Nebula versions use different labels for the product-level sales report.
# Do not fall back to department summaries or daily item volume reports.
NORMAL_SALES_TITLES = ('Product Sales Enquiry', 'Item Sales Enquiry')


class ConsoleProgress:
    """Only the main thread touches Playwright; the heartbeat prints status only."""
    def __init__(self, enabled=False, interval=20, stream=None):
        self.enabled = enabled
        self.interval = interval
        self.stream = stream if stream is not None else sys.stdout
        self.stage = 'Starting downloader'
        self.started = time.monotonic()
        self.stage_started = self.started
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.thread = None

    def __call__(self, stage):
        with self.lock:
            self.stage = stage
            self.stage_started = time.monotonic()
            if self.enabled:
                self.write(stage)

    def write(self, message):
        print('[' + time.strftime('%H:%M:%S') + '] ' + message, file=self.stream, flush=True)

    def heartbeat(self):
        while not self.stop.wait(self.interval):
            with self.lock:
                elapsed = int(time.monotonic() - self.stage_started)
                self.write('Still working: ' + self.stage + ' (' + str(elapsed) + 's on this step)')

    def __enter__(self):
        if self.enabled:
            self.thread = threading.Thread(target=self.heartbeat, daemon=True)
            self.thread.start()
        return self

    def __exit__(self, *args):
        self.stop.set()
        if self.thread is not None:
            self.thread.join()


def report_title_pattern(source, title):
    names = NORMAL_SALES_TITLES if source == 'normal_sales' else (title,)
    return re.compile(r'^\s*(?:\d+\s*\.\s*)?(?:' + '|'.join(re.escape(name) for name in names) + r')\s*$')


class CrmExportError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def requested_day(start, end):
    day = date.fromisoformat(start)
    if day.isoformat() != start or start != end:
        raise ValueError('Nebula movement exports require exactly one ISO calendar day per job')
    return day.strftime('%d/%m/%Y')


def checked_url(value):
    url = urlsplit(value)
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Invalid CRM URL; save a plain HTTP or HTTPS address without credentials')
    return value


def check_store_marker(body, expected):
    codes = re.findall(r'Store\s+Info\s*:\s*(\d+)', body, flags=re.I)
    if not codes or set(codes) != {expected}:
        raise CrmExportError('wrong_store', 'CRM store identity does not match the requested store code; check its saved URL')


def visible(locator):
    for i in range(locator.count()):
        candidate = locator.nth(i)
        if candidate.is_visible():
            return candidate
    return None


def wait_for(page, find, message, timeout=180000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        result = find()
        if result is not None:
            return result
        page.wait_for_timeout(250)
    raise ValueError(message)


def explorer_frame(page):
    for frame in page.frames:
        try:
            body = frame.locator('body').inner_text(timeout=500)
            if 'Report List' in body and 'Selected Report' in body:
                return frame
        except Exception:
            pass
    return None


def open_explorer(page):
    for attempt in range(3):
        existing = explorer_frame(page)
        if existing is not None:
            return existing
        reports = wait_for(page, lambda: visible(page.get_by_text('Reports', exact=True)), 'Reports menu not found')
        reports.hover()
        explorer = wait_for(page, lambda: visible(page.get_by_text('Explorer', exact=True)), 'Explorer menu not found')
        explorer.click()
        try:
            return wait_for(page, lambda: explorer_frame(page), 'Explorer frame did not load', timeout=120000)
        except ValueError:
            if attempt == 2:
                raise


def select_report(page, category, title, source, progress=None):
    # Category selection can replace the iframe during an ASP.NET postback.
    # Always resolve controls in the current frame rather than retaining the
    # frame from the previous screen.
    pattern = report_title_pattern(source, title)
    progress = progress or (lambda message: None)

    def category_control():
        current = explorer_frame(page)
        return visible(current.get_by_text(category, exact=True)) if current is not None else None

    progress('Opening report category: ' + category)
    wait_for(page, category_control, 'Report category did not become ready').click()

    def report_control():
        current = explorer_frame(page)
        if current is None:
            return None
        matches = current.get_by_text(pattern)
        options = [matches.nth(i) for i in range(matches.count()) if matches.nth(i).is_visible()]
        if source == 'wastage' and len(options) > 1:
            options = [item for item in options if re.match(r'^9\s*\.', item.inner_text().strip())]
        if len(options) > 1:
            raise ValueError('Requested report name is ambiguous')
        return options[0] if options else None

    progress('Waiting for the product-level sales report' if source == 'normal_sales' else 'Waiting for report: ' + title)
    wait_for(page, report_control, 'Requested report did not become ready').click()

    def selected_report():
        current = explorer_frame(page)
        if current is None:
            return None
        body = current.locator('body').inner_text()
        match = re.search(r'Selected Report\s*:\s*([^\n]+)', body)
        return current if match and pattern.fullmatch(match.group(1)) else None

    progress('Waiting for selected report filters to load')
    return wait_for(page, selected_report, 'Selected report screen did not become ready')


def date_input(frame, label):
    associated = frame.get_by_label(re.compile(r'^' + label + r'\s*\*?$'))
    fields = [associated.nth(i) for i in range(associated.count()) if associated.nth(i).is_visible()]
    if len(fields) > 1:
        raise CrmExportError('date_controls', 'Report date controls are ambiguous; verify the CRM layout')
    if len(fields) == 1:
        return fields[0]
    matches = frame.get_by_text(re.compile(r'^' + label + r'\s*\*?$'))
    captions = [matches.nth(i) for i in range(matches.count()) if matches.nth(i).is_visible()]
    if len(captions) != 1:
        raise CrmExportError('date_controls', 'Report date controls are ambiguous; verify the CRM layout')
    target = captions[0].locator('xpath=following::input[not(@type="hidden")][1]')
    if target.count() != 1 or not target.is_visible():
        raise ValueError('Report date input not found')
    return target


def select_day(frame, day, progress=None):
    progress = progress or (lambda message: None)
    progress('Selecting Date Range')
    radio = frame.get_by_role('radio', name='Date Range', exact=True)
    if radio.count() != 1:
        label = frame.get_by_text('Date Range', exact=True)
        if label.count() != 1:
            raise ValueError('Date Range option not found')
        radio = label.locator('xpath=preceding-sibling::input[@type="radio"][1]')
    if radio.count() != 1:
        raise ValueError('Date Range radio is ambiguous; verify the CRM layout')
    radio.check()
    for label in ('From Date', 'To Date'):
        progress('Setting ' + label + ': ' + day)
        target = date_input(frame, label)
        target.fill(day)
        target.press('Tab')  # Commit the CRM date control/change handler.
        if target.input_value().strip() != day:
            raise ValueError('CRM did not retain the requested daily date')
    if not radio.is_checked():
        raise ValueError('CRM Date Range selection was not retained')



def verify_wastage_filters(frame):
    """Reject a Wastage export when the active report/filter identity is unclear."""
    body = frame.locator('body').inner_text()
    if not re.search(r'Selected Report\\s*:\\s*(?:\\d+\\s*\\.\\s*)?Wastage\\b', body, re.I):
        raise CrmExportError('wastage_report', 'Wastage report is not selected; export cancelled')
    # The CRM must retain the explicitly chosen date range.
    date_range = frame.get_by_role('radio', name='Date Range', exact=True)
    if date_range.count() != 1 or not date_range.is_checked():
        raise CrmExportError('wastage_filters', 'Wastage Date Range is not selected')
    from_day = date_input(frame, 'From Date').input_value().strip()
    to_day = date_input(frame, 'To Date').input_value().strip()
    if not from_day or from_day != to_day:
        raise CrmExportError('wastage_filters', 'Wastage dates are missing or inconsistent')
    # The stock adjustment report may expose reason/group filters in
    # different CRM versions. Require explicit review of empty exports
    # downstream rather than assuming zero wastage.


def export_report(context, page, frame, output, timeout, progress=None):
    progress = progress or (lambda message: None)
    progress('Opening report preview; CRM generation can take up to 20 minutes')
    with context.expect_page(timeout=timeout) as popup:
        frame.locator('#lnkView').click()
    report = popup.value
    def find_export():
        for scope in report.frames:
            # SSRS puts the same Export tooltip on both its layout TABLE and
            # the inner ButtonLink. Clicking the table's centre misses the link.
            control = visible(scope.locator('a[title*="Export"], a[alt*="Export"], button[title*="Export"], input[title*="Export"]'))
            if control is not None:
                return control
            target = visible(scope.locator('[title*="Export"], [alt*="Export"]'))
            if target is not None:
                control = visible(target.locator('a, button, [role="button"], input[type="button"]'))
                if control is not None:
                    return control
                # ReportViewer may put the tooltip on an image inside the
                # actual clickable toolbar control.
                control = target.locator('xpath=ancestor-or-self::*[self::a or self::button or @role="button" or @onclick][1]')
                if control.count() == 1 and control.is_visible():
                    return control
                return target
        return None
    progress('Waiting for the report export control; CRM generation can take up to 20 minutes')
    wait_for(page, find_export, 'Report export control did not become ready', timeout)

    def find_excel():
        for scope in report.frames:
            # Prefer the real anchor, avoiding an outer container with the same text.
            excel_name = re.compile(r'^Excel(?:\s*\((?:97[-–]2003|\.xlsx?|Open XML)\)|\s+97[-–]2003)?\s*$', re.I)
            target = visible(scope.get_by_role('link', name=excel_name))
            if target is None:
                target = visible(scope.get_by_text(excel_name))
            if target is not None:
                return target
        return None
    # A visible ReportViewer toolbar can precede its menu initialization.
    # Confirm the menu actually opened instead of waiting a report-generation
    # timeout for an option that was never displayed.
    excel = None
    for attempt in range(3):
        progress('Opening export menu (attempt ' + str(attempt + 1) + '/3)')
        excel = find_excel()
        if excel is not None:
            break
        wait_for(page, find_export, 'Report export control not ready', min(timeout, 10000)).click()
        try:
            excel = wait_for(page, find_excel, 'Excel export menu did not open', min(timeout, 5000))
            break
        except ValueError:
            if attempt == 2:
                raise CrmExportError('crm_export', 'Excel export menu did not open after three attempts') from None
    downloads = []
    def track(new_page):
        new_page.on('download', lambda artifact: downloads.append(artifact))
    for existing in context.pages:
        track(existing)
    context.on('page', track)
    progress('Downloading Excel; the CRM can take up to 20 minutes')
    excel.click()
    artifact = wait_for(page, lambda: downloads[0] if downloads else None,
                        'CRM Excel download did not complete', timeout)
    if artifact.failure():
        raise ValueError('CRM Excel download failed')
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + '.part')
    progress('Saving the downloaded Excel file')
    artifact.save_as(str(partial))
    if not partial.is_file() or not partial.stat().st_size:
        raise ValueError('CRM returned an empty report file')
    partial.replace(destination)
    progress('Download complete: ' + str(destination.stat().st_size) + ' bytes saved')


def download(url, store_code, source, start, end, output, login_env='MIESZKO_CRM_LOGIN_CODE', timeout=1200000, progress=None):
    progress = progress or (lambda message: None)
    day = requested_day(start, end)
    checked_url(url)
    if source not in REPORTS or not re.fullmatch(r'\d{4}', store_code):
        raise ValueError('Unsupported report or store code')
    login_code = os.environ.get(login_env)
    if not login_code:
        raise CrmExportError('login_config', 'CRM login environment variable is missing')
    from playwright.sync_api import sync_playwright
    progress('Starting Chromium')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'))
        context = browser.new_context(accept_downloads=True)
        try:
            page = context.new_page()
            page.set_default_timeout(180000)
            for attempt in range(3):
                try:
                    progress('Loading CRM login page (attempt ' + str(attempt + 1) + '/3)')
                    page.goto(url, wait_until='domcontentloaded', timeout=60000)
                    page.get_by_placeholder('Barcode').wait_for(timeout=10000)
                    break
                except Exception:
                    if attempt == 2:
                        raise CrmExportError('login_page', 'CRM login page unavailable; check the saved store URL') from None
            progress('Signing in to CRM')
            page.get_by_placeholder('Barcode').fill(login_code)
            page.get_by_role('button', name='Login', exact=True).click()
            wait_for(page, lambda: visible(page.get_by_text('Reports', exact=True)), 'CRM login did not reach the reports menu')
            progress('Verifying store identity')
            check_store_marker(page.locator('body').inner_text(), store_code)
            progress('Opening Reports > Explorer')
            open_explorer(page)
            category, title = REPORTS[source]
            frame = select_report(page, category, title, source, progress)
            select_day(frame, day, progress)
            if source == 'wastage':
                progress('Verifying Wastage report and date filters')
                verify_wastage_filters(frame)
            progress('Verifying store identity again before export')
            check_store_marker(page.locator('body').inner_text(), store_code)
            export_report(context, page, frame, output, timeout, progress)
        finally:
            context.close()
            browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prompt-login', action='store_true', help='Prompt locally for a hidden CRM login code for a download-only test')
    parser.add_argument('--progress', action='store_true', help='Print stages and a heartbeat every 20 seconds; enabled automatically with --prompt-login')
    for name in ('url', 'store-code', 'source', 'start', 'end', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    progress = None
    try:
        if args.prompt_login:
            os.environ['MIESZKO_CRM_LOGIN_CODE'] = getpass.getpass('CRM login code (hidden): ')
        with ConsoleProgress(args.progress or args.prompt_login) as progress:
            download(args.url, args.store_code, args.source, args.start, args.end, args.output, progress=progress)
    except KeyboardInterrupt:
        print('Download cancelled by operator.', file=sys.stderr, flush=True)
        return 130
    except Exception as error:
        # Never print Playwright call logs, which may contain the filled login code.
        details = {'error_code': error.code if isinstance(error, CrmExportError) else 'crm_export'}
        if progress is not None and progress.enabled:
            details['stage'] = progress.stage
        print(json.dumps(details), file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
