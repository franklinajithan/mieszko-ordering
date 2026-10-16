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


def select_report(page, category, title, source):
    # Category selection can replace the iframe during an ASP.NET postback.
    # Always resolve controls in the current frame rather than retaining the
    # frame from the previous screen.
    pattern = report_title_pattern(source, title)

    def category_control():
        current = explorer_frame(page)
        return visible(current.get_by_text(category, exact=True)) if current is not None else None

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

    wait_for(page, report_control, 'Requested report did not become ready').click()

    def selected_report():
        current = explorer_frame(page)
        if current is None:
            return None
        body = current.locator('body').inner_text()
        match = re.search(r'Selected Report\s*:\s*([^\n]+)', body)
        return current if match and pattern.fullmatch(match.group(1)) else None

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


def select_day(frame, day):
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
        target = date_input(frame, label)
        target.fill(day)
        target.press('Tab')  # Commit the CRM date control/change handler.
        if target.input_value().strip() != day:
            raise ValueError('CRM did not retain the requested daily date')
    if not radio.is_checked():
        raise ValueError('CRM Date Range selection was not retained')


def export_report(context, page, frame, output, timeout):
    with context.expect_page(timeout=timeout) as popup:
        frame.locator('#lnkView').click()
    report = popup.value
    def find_export():
        for scope in report.frames:
            target = visible(scope.locator('[title*="Export"], [alt*="Export"]'))
            if target is not None:
                return target
        return None
    wait_for(page, find_export, 'Report export control did not become ready', timeout).click()

    def find_excel():
        for scope in report.frames:
            # Prefer the real anchor, avoiding an outer container with the same text.
            target = visible(scope.get_by_role('link', name='Excel', exact=True))
            if target is None:
                target = visible(scope.get_by_text('Excel', exact=True))
            if target is not None:
                return target
        return None
    excel = wait_for(page, find_excel, 'Excel export option not found', timeout)
    downloads = []
    def track(new_page):
        new_page.on('download', lambda artifact: downloads.append(artifact))
    for existing in context.pages:
        track(existing)
    context.on('page', track)
    excel.click()
    artifact = wait_for(page, lambda: downloads[0] if downloads else None,
                        'CRM Excel download did not complete', timeout)
    if artifact.failure():
        raise ValueError('CRM Excel download failed')
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + '.part')
    artifact.save_as(str(partial))
    if not partial.is_file() or not partial.stat().st_size:
        raise ValueError('CRM returned an empty report file')
    partial.replace(destination)


def download(url, store_code, source, start, end, output, login_env='MIESZKO_CRM_LOGIN_CODE', timeout=1200000):
    day = requested_day(start, end)
    checked_url(url)
    if source not in REPORTS or not re.fullmatch(r'\d{4}', store_code):
        raise ValueError('Unsupported report or store code')
    login_code = os.environ.get(login_env)
    if not login_code:
        raise CrmExportError('login_config', 'CRM login environment variable is missing')
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'))
        context = browser.new_context(accept_downloads=True)
        try:
            page = context.new_page()
            page.set_default_timeout(180000)
            for attempt in range(3):
                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=60000)
                    page.get_by_placeholder('Barcode').wait_for(timeout=10000)
                    break
                except Exception:
                    if attempt == 2:
                        raise CrmExportError('login_page', 'CRM login page unavailable; check the saved store URL') from None
            page.get_by_placeholder('Barcode').fill(login_code)
            page.get_by_role('button', name='Login', exact=True).click()
            wait_for(page, lambda: visible(page.get_by_text('Reports', exact=True)), 'CRM login did not reach the reports menu')
            check_store_marker(page.locator('body').inner_text(), store_code)
            open_explorer(page)
            category, title = REPORTS[source]
            frame = select_report(page, category, title, source)
            select_day(frame, day)
            check_store_marker(page.locator('body').inner_text(), store_code)
            export_report(context, page, frame, output, timeout)
        finally:
            context.close()
            browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prompt-login', action='store_true', help='Prompt locally for a hidden CRM login code for a download-only test')
    for name in ('url', 'store-code', 'source', 'start', 'end', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        if args.prompt_login:
            os.environ['MIESZKO_CRM_LOGIN_CODE'] = getpass.getpass('CRM login code (hidden): ')
        download(args.url, args.store_code, args.source, args.start, args.end, args.output)
    except Exception as error:
        # Never print Playwright call logs, which may contain the filled login code.
        print(json.dumps({'error_code': error.code if isinstance(error, CrmExportError) else 'crm_export'}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
