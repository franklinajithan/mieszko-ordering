"""Run office-only Excel report batches using the configured Ubuntu worker."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
import fcntl
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from threading import Event, Lock, Thread
from zipfile import ZipFile

from item_sales_enquiry import checked_directory, now_ms, publish, publish_workbook, valid_xlsx
from linux_worker import runtime_environment
from nebula_download import check_store_marker, date_input, export_report, report_session, report_title_pattern, select_report
from worker import CRM_STORE_CODES, crm_store_code, get_store_config, london_today

REPORTS = {
    'item_sales': ('Sales', '6. Item Sales Enquiry'),
    'rtc': ('History', '3. Price Override & RTC Sales History'),
    'wastage': ('Stock', '2. Stock Adjustment'),
    'stock_adjustment_extra': ('Stock', '2. Stock Adjustment'),
    'daily_item_volume': ('Sales', '22. Daily Item Volume'),
}
STORES = dict(zip(
    ('HNS', 'STR', 'GRV', 'WTF', 'EAS', 'HYS', 'PVL'),
    ('Hounslow', 'Streatham', 'Gravesend', 'Watford', 'Eastham', 'Hayes', 'Perivale'),
))
REASONS = ('Damaged', 'Out of Date', 'Store Use', 'Consider as Credit Note')


def set_dates(frame, start, end):
    radio = frame.get_by_role('radio', name='Date Range', exact=True)
    if radio.count() != 1:
        radio = frame.get_by_text('Date Range', exact=True).locator('xpath=preceding-sibling::input[@type="radio"][1]')
    radio.check()
    dates = [(label, date.fromisoformat(value).strftime('%d/%m/%Y'))
             for label, value in [('From Date', start), ('To Date', end)]]
    for label, value in dates:
        field = date_input(frame, label)
        field.fill(value)
        field.press('Tab')
    if not radio.is_checked() or any(date_input(frame, label).input_value().strip() != value for label, value in dates):
        raise ValueError('CRM did not retain both report dates')


def configure_stock_filters(frame, extra):
    for label in ('ALL', 'Stock Adjustment Date'):
        frame.get_by_label(label, exact=True).check()
    group = frame.get_by_label(re.compile(r'^Group Level\s*:?$')).and_(frame.locator('select'))
    if group.count() != 1:
        group = frame.locator('select').filter(has=frame.get_by_role('option', name='Item Group', exact=True))
    group.select_option(label='Item')

    # Handle native multi-selects and checkbox-based CRM controls.
    reason_field = frame.get_by_text(re.compile(r'^Stock Adj\.\s*Reason\s*:$', re.I)).locator('xpath=..')
    native = reason_field.locator('select[multiple]:visible')
    wanted = REASONS if extra else REASONS[:3]
    if native.count() == 1:
        native.select_option(label=list(wanted))
        selected = native.locator('option:checked').all_text_contents()
        if {text.strip() for text in selected} != set(wanted):
            raise ValueError('CRM did not retain the stock adjustment reasons')
        return

    def reason_box(label):
        box = frame.get_by_role('checkbox', name=label, exact=True)
        if box.count() == 0:
            box = frame.get_by_text(label, exact=True).locator('xpath=..').locator('input[type=checkbox]')
        return box

    toggle = reason_field.locator('button.multiselect:visible, button.dropdown-toggle:visible')
    opened = not reason_box(wanted[0]).is_visible() and toggle.count() == 1
    if opened:
        toggle.click()
    # The multiselect normally contains all reasons. Scope changes to the
    # reason group so a similarly named checkbox elsewhere is never modified.
    first = reason_box(wanted[0])
    group = first.locator('xpath=ancestor::ul[1]')
    boxes = group.locator('input[type=checkbox]') if group.count() == 1 else reason_field.locator('input[type=checkbox]')
    choices = [reason_box(label) for label in wanted]
    if not boxes.count() or any(box.count() != 1 or not box.is_visible() for box in choices):
        raise ValueError('Could not identify the stock adjustment reason options')
    if any(not box.evaluate('(el, items) => items.includes(el)', boxes.element_handles()) for box in choices):
        raise ValueError('Stock adjustment reasons are outside their filter group')
    for box in boxes.all():
        if box.is_visible() and box.is_checked():
            box.uncheck()
    for box in choices:
        box.check()
    if any(not box.is_checked() for box in choices) or boxes.evaluate_all(
        '(items) => items.filter(el => el.checked).length'
    ) != len(wanted):
        raise ValueError('CRM did not retain the requested stock adjustment reasons')
    if opened:
        toggle.click()


def report_path(root, row):
    filename = f"{row['start']}_to_{row['end']}.xlsx"
    return root / 'files' / STORES[row['store']] / row['report'] / filename


def create_zip(root, folder, rows):
    files = [(report_path(root, row), row) for row in rows if row['state'] in ('completed', 'skipped')]
    if not files:
        return False
    temporary = folder / 'reports.part'
    try:
        with ZipFile(temporary, 'w') as archive:
            for source, row in files:
                name = f"{row['report']}_{source.name}"
                archive.write(source, f"{STORES[row['store']]}/{name}")
        temporary.replace(folder / 'reports.zip')
    finally:
        temporary.unlink(missing_ok=True)
    return True


def run_reports(root, job, settings, update):
    def run_store(store):
        rows = [row for row in job['reports'] if row['store'] == store]
        session = None
        try:
            for row in rows:
                target = report_path(root, row)
                if target.resolve() == target and valid_xlsx(target):
                    update(row, 'skipped', 'Existing workbook is valid')
                    continue
                if store not in settings:
                    update(row, 'failed', 'Save a CRM URL for this store in CRM Downloads.')
                    continue
                for attempt in range(1, 3):
                    stage = 'Opening store session'

                    def progress(message):
                        nonlocal stage
                        stage = message
                        update(row, 'running', message)

                    try:
                        progress(stage)
                        marker = CRM_STORE_CODES[store]
                        if session is None:
                            manager = report_session(settings[store], marker, 'MIESZKO_CRM_LOGIN_CODE', progress)
                            context, page = manager.__enter__()
                            session = manager
                        report = row['report']
                        category, title = REPORTS[report]
                        frame = select_report(page, category, title, report, progress, category_may_be_open=True)
                        progress('Setting the report dates')
                        set_dates(frame, row['start'], row['end'])
                        if report in ('wastage', 'stock_adjustment_extra'):
                            progress('Setting the stock adjustment filters')
                            configure_stock_filters(frame, report == 'stock_adjustment_extra')
                        progress('Verifying report, dates and store')
                        selected = re.search(r'Selected Report[ \t]*:[ \t]*([^\n]+)', frame.locator('body').inner_text())
                        if not selected or not report_title_pattern(report, title).fullmatch(selected.group(1)):
                            raise ValueError('CRM changed the selected report')
                        for label, key in [('From Date', 'start'), ('To Date', 'end')]:
                            expected = date.fromisoformat(row[key]).strftime('%d/%m/%Y')
                            if date_input(frame, label).input_value().strip() != expected:
                                raise ValueError('CRM changed the requested dates')
                        check_store_marker(page.locator('body').inner_text(), marker)
                        checked_directory(target.parent)
                        with TemporaryDirectory(dir=target.parent) as work:
                            source = Path(work) / 'crm-download'
                            export_report(context, page, frame, source, 1200000, progress, close_preview=True)
                            progress('Validating and saving the Excel workbook')
                            publish_workbook(source, target)
                        update(row, 'completed', 'Workbook saved')
                        break
                    except Exception:
                        if session is not None:
                            close_session(session)
                            session = None
                        update(row, 'failed' if attempt == 2 else 'running', f'{stage} failed (attempt {attempt} of 2).')
        finally:
            if session is not None:
                close_session(session)

    stores = list(dict.fromkeys(row['store'] for row in job['reports']))
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(run_store, stores))


def close_session(session):
    try:
        session.__exit__(None, None, None)
    except Exception:
        pass


def store_settings(worker):
    os.environ.update(runtime_environment(worker, os.environ))
    config = json.loads((worker / 'automation/config.local.json').read_text(encoding='utf-8-sig'))
    if config.get('store_settings_source') != 'database':
        raise ValueError('Database-backed worker required')
    import psycopg
    by_code = {}
    with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, connect_timeout=10) as conn:
        for store_id, code in conn.execute("SELECT id, code FROM stores WHERE is_active AND erp_type = 'msp'"):
            try:
                by_code.setdefault(crm_store_code(code), []).append(store_id)
            except ValueError:
                continue
        settings = {}
        for store in STORES:
            ids = by_code.get(CRM_STORE_CODES[store], [])
            if len(ids) == 1:
                try:
                    settings[store] = get_store_config(conn, config, ids[0])['crm_url']
                except ValueError:
                    continue
        return settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker-directory', required=True, type=Path)
    parser.add_argument('--archive', required=True, type=Path)
    args = parser.parse_args()
    job = json.load(sys.stdin)
    if not re.fullmatch(r'[0-9a-f-]{36}', job['id']):
        raise ValueError('Invalid job ID')
    for row in job['reports']:
        start, end = date.fromisoformat(row['start']), date.fromisoformat(row['end'])
        if (row['store'] not in STORES or row['report'] not in REPORTS or
                start > end or end > london_today() or (end - start).days >= 366):
            raise ValueError('Invalid report selection')
    root = checked_directory(args.archive.resolve(strict=True) / 'report-downloader')
    with os.fdopen(os.open(root / 'run.lock', os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600), 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('busy', flush=True)
            return
        folder = checked_directory(checked_directory(root / 'jobs') / job['id'])
        job.update(state='running', startedAt=now_ms(), zipReady=False)
        heartbeat = folder / 'heartbeat'
        heartbeat.touch()
        publish(folder, job)
        print('ready', flush=True)

        stop = Event()

        def beat():
            while not stop.wait(5):
                heartbeat.touch()

        thread = Thread(target=beat, daemon=True)
        thread.start()
        status_lock = Lock()

        def update(row, state, message):
            with status_lock:
                row.update(state=state, message=message)
                publish(folder, job)

        try:
            pending = any(report_path(root, row).resolve() != report_path(root, row)
                          or not valid_xlsx(report_path(root, row)) for row in job['reports'])
            settings = store_settings(args.worker_directory.resolve(strict=True)) if pending else {}
            run_reports(root, job, settings, update)
        except Exception:
            for row in job['reports']:
                if row['state'] in ('waiting', 'running'):
                    source = report_path(root, row)
                    if source.resolve() == source and valid_xlsx(source):
                        row.update(state='skipped', message='Existing workbook is valid')
                    else:
                        row.update(state='failed', message='The report worker could not finish. Check its Ubuntu and CRM configuration.')
        try:
            job['zipReady'] = create_zip(root, folder, job['reports'])
            job['state'] = 'failed' if any(row['state'] == 'failed' for row in job['reports']) else 'completed'
        except Exception:
            job.update(state='failed', error='Could not create the ZIP. Check archive space and start the same selection again.')
        finally:
            stop.set()
            thread.join()
            publish(folder, job)


if __name__ == '__main__':
    os.umask(0o077)
    main()
