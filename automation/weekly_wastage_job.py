"""Generate the four weekly CRM exports, store workbooks and office summary."""
import argparse
import ctypes
from datetime import date, datetime, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import NamedTemporaryFile, TemporaryDirectory
from zipfile import ZipFile

from linux_worker import runtime_environment
from nebula_download import (
    REPORTS, check_store_marker, explorer_frame, export_report, report_session,
    select_report, visible, wait_for,
)
from worker import crm_store_code, get_store_config, london_today

APP = Path(__file__).resolve().parent.parent
REPORT_TYPES = {
    'Sales': ('normal_sales', *REPORTS['normal_sales']),
    'RTC': ('rtc', *REPORTS['rtc']),
    'Wastage': ('wastage', *REPORTS['wastage']),
    'Daily_Sales_by_Department': ('department', 'Sales', 'Daily Sales by Department'),
}
DATE_RANGE = re.compile(r'(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}/\d{2}/\d{4})')


def previous_week(today):
    monday = today - timedelta(days=today.weekday())
    return monday - timedelta(days=7), monday - timedelta(days=1)


def select_week(page, frame, start, end):
    expected = (start.strftime('%d/%m/%Y'), end.strftime('%d/%m/%Y'))
    wait_for(page, lambda: visible(frame.get_by_text('Week', exact=True)),
             'Weekly filter did not become ready').click()

    def matching_checkbox():
        current = explorer_frame(page)
        if current is None:
            return None
        matches = []
        for checkbox in current.locator('input[type="checkbox"]').all():
            if checkbox.is_visible():
                row = checkbox.locator('xpath=ancestor::tr[1]')
                dates = DATE_RANGE.search(row.inner_text()) if row.count() else None
                if dates and dates.groups() == expected:
                    matches.append(checkbox)
        if len(matches) > 1:
            raise ValueError('More than one CRM row matches the requested week')
        return matches[0] if matches else None

    checkbox = wait_for(page, matching_checkbox, f'CRM week {expected[0]} - {expected[1]} unavailable', 30000)
    checkbox.check()
    def selected_frame():
        current = explorer_frame(page)
        if current is None:
            return None
        ranges = []
        for box in current.locator('input[type="checkbox"]:checked').all():
            row = box.locator('xpath=ancestor::tr[1]')
            dates = DATE_RANGE.search(row.inner_text()) if box.is_visible() and row.count() else None
            if dates:
                ranges.append(dates.groups())
        return current if ranges == [expected] else None

    return wait_for(page, selected_frame, 'CRM did not select exactly the requested week', 10000)


def configured_stores(database_url):
    import psycopg

    with psycopg.connect(database_url, connect_timeout=10,
                         options='-c default_transaction_read_only=on') as conn:
        rows = conn.execute("""SELECT id, name FROM stores
            WHERE is_active=true AND erp_type='msp' ORDER BY name""").fetchall()
        stores = {}
        for store_id, name in rows:
            if not re.fullmatch(r"[\w][\w .'-]*", name) or name in stores:
                raise ValueError('Active CRM store names must be unique and safe for file paths')
            stores[name] = store_id
    if not stores:
        raise ValueError('No active MSP stores are configured')
    return stores


def store_connection(database_url, store_id):
    import psycopg

    with psycopg.connect(database_url, connect_timeout=10,
                         options='-c default_transaction_read_only=on') as conn:
        config = {'store_settings_source': 'database', 'store_defaults': {}}
        settings = get_store_config(conn, config, store_id)
    return settings['crm_url'], crm_store_code(settings['code'])


def process_store(folder, name, url, code, start, end):
    week = f'{start:%d-%m-%Y}_to_{end:%d-%m-%Y}'
    exports = {label: folder / f'{name}_{label}_{week}.xls' for label in REPORT_TYPES}

    def progress(message):
        print(f'{name}: {message}', flush=True)

    for label, (source, category, title) in REPORT_TYPES.items():
        progress(f'Downloading {label}')
        # Use an independent report session so filters and popups cannot carry
        # over from another report.
        with report_session(url, code, 'MIESZKO_CRM_LOGIN_CODE', progress) as (context, page):
            frame = select_report(page, category, title, source, progress)
            frame = select_week(page, frame, start, end)
            check_store_marker(page.locator('body').inner_text(), code)
            export_report(context, page, frame, exports[label], 1200000, progress)

    subprocess.run([
        sys.executable, str(APP / 'automation/weekly_wastage/store_workbook.py'),
        '--wastage', str(exports['Wastage']), '--rtc', str(exports['RTC']),
        '--sales', str(exports['Sales']),
    ], check=True, timeout=900)


def write_status(root, start, end, state, stores, stage):
    status_dir = root / '.status'
    status_dir.mkdir(exist_ok=True)
    payload = {
        'start': start.isoformat(), 'end': end.isoformat(), 'state': state,
        'stage': stage, 'stores': stores, 'updatedAt': datetime.now(timezone.utc).isoformat(),
    }
    with NamedTemporaryFile(mode='w', dir=status_dir, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(payload, handle)
            handle.close()
            temporary.replace(status_dir / f'{start.isoformat()}.json')
        finally:
            temporary.unlink(missing_ok=True)


def create_archive(folder):
    output = folder / 'Weekly_Wastage.zip'
    with NamedTemporaryFile(dir=folder, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with ZipFile(temporary, 'w') as archive:
            for workbook in sorted(folder.rglob('*.xlsx')):
                archive.write(workbook, workbook.relative_to(folder))
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def refresh_published_summary(summary):
    from openpyxl import load_workbook
    from weekly_wastage.summary_workbook import set_weekly_total_waste

    workbook = load_workbook(summary)
    try:
        sheet = workbook['Weekly Summary']
        if not set_weekly_total_waste(sheet):
            return
        with NamedTemporaryFile(dir=summary.parent, delete=False) as handle:
            temporary = Path(handle.name)
        try:
            workbook.save(temporary)
            temporary.replace(summary)
        finally:
            temporary.unlink(missing_ok=True)
    finally:
        workbook.close()


def publish_week(staged, final):
    if not final.exists() and not final.is_symlink():
        staged.rename(final)
        return
    if final.is_symlink() or not final.is_dir():
        raise ValueError('Invalid weekly report directory')
    # Ubuntu can exchange two populated directories without a window where the ZIP is missing.
    rename = ctypes.CDLL(None, use_errno=True).renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    at_fdcwd, rename_exchange = -100, 2
    if rename(at_fdcwd, os.fsencode(staged), at_fdcwd, os.fsencode(final), rename_exchange):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def run_week(root, start, end, stores=None, resolve_store=None, *, redownload=False, on_start=None):
    period = f'{start:%d.%m.%Y} - {end:%d.%m.%Y}'
    final = root / f'Weekly Waste {period}'
    with (root / '.weekly-wastage.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        progress = {}
        try:
            summary = final / 'Weekly_Wastage_Summary.xlsx'
            if summary.is_file() and not redownload:
                refresh_published_summary(summary)
                archive = final / 'Weekly_Wastage.zip'
                if not archive.is_file() or archive.stat().st_mtime_ns < summary.stat().st_mtime_ns:
                    create_archive(final)
                progress = {folder.name: {'state': 'complete', 'attempt': None}
                            for folder in final.iterdir() if folder.is_dir()}
                write_status(root, start, end, 'complete', progress, 'ZIP ready')
                print(f'Weekly summary already published: {final}', flush=True)
                return

            write_status(root, start, end, 'running', progress, 'Loading store settings')
            if on_start:
                on_start()
            if stores is None:
                env = runtime_environment(APP, os.environ)
                os.environ.update(env)
                database_url = env['DATABASE_URL']
                stores = configured_stores(database_url)
                resolve_store = lambda store_id: store_connection(database_url, store_id)
            progress = {name: {'state': 'waiting', 'attempt': None} for name in stores}

            with TemporaryDirectory(prefix='.weekly-wastage-', dir=root) as temporary:
                staged = Path(temporary) / final.name
                staged.mkdir()
                failures = []
                for name, store in stores.items():
                    folder = staged / name
                    for attempt in range(1, 4):
                        progress[name] = {'state': 'running', 'attempt': attempt}
                        write_status(root, start, end, 'running', progress, 'Downloading and processing reports')
                        folder.mkdir()
                        try:
                            url, code = resolve_store(store) if resolve_store else store
                            process_store(folder, name, url, code, start, end)
                            progress[name]['state'] = 'complete'
                            break
                        except Exception as exc:
                            print(f'{name}: attempt {attempt}/3 failed ({type(exc).__name__})', flush=True)
                            shutil.rmtree(folder)
                            if attempt == 3:
                                failures.append(name)
                                progress[name]['state'] = 'failed'
                if failures:
                    raise ValueError('Weekly workbook could not be built for ' + ', '.join(failures))
                write_status(root, start, end, 'running', progress, 'Building the combined workbook')
                from weekly_wastage.summary_workbook import build_summary

                _, errors, _, dept_errors, _, rtc_errors = build_summary(
                    staged, period, staged / 'Weekly_Wastage_Summary.xlsx',
                    '*_Wastage_*.xlsx', '*_Sales_*.xlsx', summary_title='Weekly Summary',
                )
                issues = errors + dept_errors + rtc_errors
                if issues:
                    raise ValueError('Summary validation failed:\n' + '\n'.join(issues))
                write_status(root, start, end, 'running', progress, 'Packaging the ZIP')
                create_archive(staged)
                publish_week(staged, final)
                write_status(root, start, end, 'complete', progress, 'ZIP ready')
                print(f'Weekly summary published: {final}', flush=True)
        except Exception:
            write_status(root, start, end, 'failed', progress, 'Check the Ubuntu worker log for details')
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home() / 'Mieszko' / 'Weekly Wastage')
    parser.add_argument('--week-start', type=date.fromisoformat, help='Monday of a completed week')
    parser.add_argument('--redownload', action='store_true', help='Fetch all CRM reports again and replace the published week')
    args = parser.parse_args()
    today = london_today()
    start, end = previous_week(today)
    if args.week_start:
        start = args.week_start
        end = start + timedelta(days=6)
        if start.weekday() != 0 or end >= today:
            parser.error('--week-start must be the Monday of a completed week')
    try:
        root = args.output.expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        run_week(root, start, end, redownload=args.redownload,
                 on_start=(lambda: print('ready', flush=True)) if args.redownload else None)
    except BlockingIOError:
        print('busy', flush=True)
        return 1
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f'Weekly wastage failed ({type(exc).__name__}). Check the runtime, database and output folder.',
              file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    os.umask(0o077)
    raise SystemExit(main())
