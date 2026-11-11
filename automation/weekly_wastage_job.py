"""Generate the four weekly CRM exports, store workbooks and office summary."""
import argparse
from datetime import date, timedelta
import fcntl
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

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
        config = {'store_settings_source': 'database', 'store_defaults': {}}
        stores = {}
        for store_id, name in rows:
            if not re.fullmatch(r"[\w][\w .'-]*", name) or name in stores:
                raise ValueError('Active CRM store names must be unique and safe for file paths')
            settings = get_store_config(conn, config, store_id)
            stores[name] = (settings['crm_url'], crm_store_code(settings['code']))
    if not stores:
        raise ValueError('No active MSP stores are configured')
    return stores


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


def run_week(root, start, end, stores):
    from weekly_wastage.summary_workbook import build_summary

    period = f'{start:%d.%m.%Y} - {end:%d.%m.%Y}'
    final = root / f'Weekly Waste {period}'
    with (root / '.weekly-wastage.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if (final / 'Weekly_Wastage_Summary.xlsx').is_file():
            print(f'Weekly summary already published: {final}', flush=True)
            return
        with TemporaryDirectory(prefix='.weekly-wastage-', dir=root) as temporary:
            staged = Path(temporary) / final.name
            staged.mkdir()
            failures = []
            for name, (url, code) in stores.items():
                folder = staged / name
                for attempt in range(1, 4):
                    folder.mkdir()
                    try:
                        process_store(folder, name, url, code, start, end)
                        break
                    except Exception as exc:
                        print(f'{name}: attempt {attempt}/3 failed ({type(exc).__name__})', flush=True)
                        shutil.rmtree(folder)
                        if attempt == 3:
                            failures.append(name)
            if failures:
                raise ValueError('Weekly workbook could not be built for ' + ', '.join(failures))
            _, errors, _, dept_errors, _, rtc_errors = build_summary(
                staged, period, staged / 'Weekly_Wastage_Summary.xlsx',
                '*_Wastage_*.xlsx', '*_Sales_*.xlsx', summary_title='Weekly Summary',
            )
            issues = errors + dept_errors + rtc_errors
            if issues:
                raise ValueError('Summary validation failed:\n' + '\n'.join(issues))
            staged.rename(final)
            print(f'Weekly summary published: {final}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home() / 'Mieszko' / 'Weekly Wastage')
    parser.add_argument('--week-start', type=date.fromisoformat, help='Monday of a completed week')
    args = parser.parse_args()
    today = london_today()
    start, end = previous_week(today)
    if args.week_start:
        start = args.week_start
        end = start + timedelta(days=6)
        if start.weekday() != 0 or end >= today:
            parser.error('--week-start must be the Monday of a completed week')
    try:
        env = runtime_environment(APP, os.environ)
        os.environ.update(env)
        root = args.output.expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        run_week(root, start, end, configured_stores(env['DATABASE_URL']))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f'Weekly wastage failed ({type(exc).__name__}). Check the runtime, database and output folder.',
              file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
