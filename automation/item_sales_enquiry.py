"""Office-local Report 6 exports, independent of the movement import queue."""
import argparse
from datetime import date
import fcntl
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from contextlib import suppress

from linux_worker import runtime_environment
from nebula_download import (
    check_store_marker, date_input, explorer_frame, export_report, report_session,
    report_title_pattern, select_day, select_report,
)
from worker import CRM_STORE_CODES, crm_store_code, get_store_config, london_today

STORES = ('HNS', 'STR', 'GRV', 'WTF', 'EAS', 'HYS', 'PVL')
SOURCE = 'item_sales_enquiry'
TITLE = '6. Item Sales Enquiry'
XLS_SIGNATURE = bytes.fromhex('D0CF11E0A1B11AE1')


class Cancelled(Exception):
    pass


class WorkbookError(ValueError):
    pass


def valid_xlsx(path):
    from openpyxl import load_workbook
    try:
        with zipfile.ZipFile(path) as archive:
            if 'xl/workbook.xml' not in archive.namelist() or archive.testzip() is not None:
                return False
        with path.open('rb') as stream:
            workbook = load_workbook(stream, read_only=True)
            try:
                return bool(workbook.worksheets)
            finally:
                workbook.close()
    except Exception:
        return False


def publish_workbook(source, destination):
    if valid_xlsx(source):
        source.replace(destination)
        return
    with source.open('rb') as stream:
        signature = stream.read(8)
    if signature != XLS_SIGNATURE:
        raise WorkbookError('CRM returned an invalid Excel workbook')
    executable = shutil.which('libreoffice')
    if not executable:
        raise WorkbookError('Legacy XLS export requires LibreOffice Calc')
    legacy = source.with_suffix('.xls')
    source.replace(legacy)
    profile = (legacy.parent / 'profile').as_uri()
    result = subprocess.run([
        executable, f'-env:UserInstallation={profile}', '--headless',
        '--convert-to', 'xlsx:Calc MS Excel 2007 XML',
        '--outdir', str(legacy.parent), str(legacy),
    ], capture_output=True, timeout=120)
    converted = legacy.with_suffix('.xlsx')
    if result.returncode or not valid_xlsx(converted):
        raise WorkbookError('LibreOffice could not convert the legacy XLS workbook')
    converted.replace(destination)


def export_day(context, page, day, marker, output, progress):
    frame = explorer_frame(page)
    if frame is None:
        raise ValueError('Report Explorer is unavailable')
    progress('Verifying Report 6 and its date filters')
    day_text = day.strftime('%d/%m/%Y')
    select_day(frame, day_text, progress)
    body = frame.locator('body').inner_text()
    selected = re.search(r'Selected Report[ \t]*:[ \t]*([^\n]+)', body)
    if not selected or not report_title_pattern(SOURCE, TITLE).fullmatch(selected.group(1)):
        raise ValueError('Report 6 is no longer selected')
    if any(date_input(frame, label).input_value().strip() != day_text
           for label in ('From Date', 'To Date')):
        raise ValueError('CRM did not retain both report dates')
    check_store_marker(page.locator('body').inner_text(), marker)
    export_report(context, page, frame, output, 180000, progress, close_preview=True)


def checked_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    if path.resolve(strict=True) != path:
        raise ValueError('Invalid Report 6 archive directory')
    return path


def now_ms():
    return time.time_ns() // 1_000_000


def publish(folder, job):
    with tempfile.NamedTemporaryFile(mode='w', dir=folder, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(job, stream)
    try:
        temporary.replace(folder / 'status.json')
    finally:
        temporary.unlink(missing_ok=True)


def run_reports(root, folder, job, config, conn):
    known = {}
    for store_id, code in conn.execute("SELECT id, code FROM stores WHERE is_active AND erp_type = 'msp'"):
        try:
            marker = crm_store_code(code)
        except ValueError:
            continue
        known.setdefault(marker, []).append(store_id)

    def check_cancel():
        if (folder / 'cancel').exists():
            raise Cancelled()

    for store in STORES:
        rows = [row for row in job['reports'] if row['store'] == store]
        if not rows:
            continue
        session = None
        try:
            for row in rows:
                check_cancel()
                day = date.fromisoformat(row['date'])
                job['current'] = {'store': store, 'date': row['date']}
                row.update(state='running', message='Checking archived workbook')
                publish(folder, job)
                stage = row['message']

                def progress(message):
                    nonlocal stage
                    check_cancel()
                    stage = message
                    row['message'] = message
                    publish(folder, job)

                for attempt in range(2):
                    try:
                        stage = 'Checking archived workbook'
                        target = checked_directory(root / 'files' / store) / f'{day}.xlsx'
                        if not job['force'] and valid_xlsx(target):
                            row.update(state='skipped', message='Existing workbook is valid')
                            break
                        marker = CRM_STORE_CODES[store]
                        if session is None:
                            progress('Loading store CRM settings')
                            ids = known.get(marker, [])
                            if len(ids) != 1:
                                raise ValueError('Store CRM configuration is unavailable or ambiguous')
                            settings = get_store_config(conn, config, ids[0])
                            manager = report_session(settings['crm_url'], marker, 'MIESZKO_CRM_LOGIN_CODE', progress)
                            context, page = manager.__enter__()
                            session = manager
                            select_report(page, 'Sales', TITLE, SOURCE, progress)
                        with tempfile.TemporaryDirectory(dir=target.parent) as temp:
                            source = Path(temp) / 'crm-download'
                            export_day(context, page, day, marker, source, progress)
                            progress('Validating and saving Excel workbook')
                            candidate = Path(temp) / 'validated.xlsx'
                            publish_workbook(source, candidate)
                            check_cancel()
                            candidate.replace(target)
                        row.update(state='completed', message='Workbook saved')
                        break
                    except Cancelled:
                        raise
                    except Exception as error:
                        if session is not None:
                            with suppress(Exception):
                                session.__exit__(None, None, None)
                            session = None
                        detail = str(error) if isinstance(error, WorkbookError) else f'{stage} failed'
                        row.update(state='failed', message=f'{detail} (attempt {attempt + 1} of 2)')
                publish(folder, job)
                check_cancel()
        finally:
            if session is not None:
                with suppress(Exception):
                    session.__exit__(None, None, None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker-directory', required=True, type=Path)
    parser.add_argument('--archive', required=True, type=Path)
    args = parser.parse_args()
    job = json.load(sys.stdin)
    root = checked_directory(args.archive.resolve(strict=True) / 'item-sales-enquiry')
    with os.fdopen(os.open(root / 'run.lock', os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600), 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('busy', flush=True)
            return
        folder = checked_directory(checked_directory(root / 'jobs') / job['id'])
        job.update(state='running', startedAt=now_ms(), finishedAt=None, current=None)
        heartbeat = folder / 'heartbeat'
        heartbeat.touch()
        publish(folder, job)
        print('ready', flush=True)

        stop = threading.Event()

        def beat():
            while not stop.wait(5):
                heartbeat.touch()

        thread = threading.Thread(target=beat, daemon=True)
        thread.start()
        try:
            if any(date.fromisoformat(row['date']) > london_today() for row in job['reports']):
                raise ValueError('Future date')
            worker = args.worker_directory.resolve(strict=True)
            os.environ.update(runtime_environment(worker, os.environ))
            config = json.loads((worker / 'automation/config.local.json').read_text(encoding='utf-8-sig'))
            if config.get('store_settings_source') != 'database':
                raise ValueError('Database-backed worker required')
            import psycopg
            with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, connect_timeout=10) as conn:
                run_reports(root, folder, job, config, conn)
            job['state'] = 'failed' if any(row['state'] == 'failed' for row in job['reports']) else 'completed'
        except Cancelled:
            job['state'] = 'cancelled'
        except Exception:
            job['state'] = 'failed'
            for row in job['reports']:
                if row['state'] in ('waiting', 'running'):
                    row.update(state='failed', message='Report 6 worker unavailable. Check its Ubuntu and CRM configuration.')
        finally:
            stop.set()
            thread.join()
            for row in job['reports']:
                if row['state'] in ('waiting', 'running'):
                    row.update(state='cancelled', message='Cancelled before publishing')
            job.update(current=None, finishedAt=now_ms())
            publish(folder, job)


if __name__ == '__main__':
    os.umask(0o077)
    main()
