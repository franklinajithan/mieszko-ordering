"""Run Utilities > Till Receive for active Ordering stores from the office worker."""

import argparse
import json
import os
from pathlib import Path
import re
import sys

from linux_worker import runtime_environment
from nebula_download import check_store_marker, nebula_session, visible, wait_for
from worker import crm_store_code, get_store_config


def receive_button(page):
    for frame in page.frames:
        button = visible(frame.get_by_role('button', name='Receive', exact=True))
        if button is None:
            button = visible(frame.get_by_text('Receive', exact=True))
        if button is not None:
            return button
    return None


def open_till_receive(page):
    utilities = wait_for(
        page, lambda: visible(page.get_by_text(re.compile(r'^Utilities$', re.I))),
        'Utilities menu is unavailable', timeout=15000,
    )
    menu = page.get_by_text(re.compile(r'^Till Receive$', re.I))
    utilities.hover(timeout=10000)
    if visible(menu) is None:
        utilities.click(timeout=10000)
    wait_for(page, lambda: visible(menu), 'Till Receive menu is unavailable',
             timeout=10000).click(timeout=10000)
    return wait_for(page, lambda: receive_button(page),
                    'Receive button is unavailable', timeout=20000)


def till_status(page, marker):
    from playwright.sync_api import Error

    for frame in page.frames:
        try:
            rows = frame.locator('tr:visible, [role="row"]:visible').evaluate_all(
                '''rows => rows.flatMap(row => {
                    const cells = [...row.children].map(cell => cell.innerText?.trim() ?? '');
                    const checkbox = row.querySelector('input[type="checkbox"], [role="checkbox"]');
                    const checked = checkbox
                        ? checkbox.checked ?? (checkbox.getAttribute('aria-checked') === 'true')
                        : null;
                    return cells.flatMap((cell, i) => cell.match(/^\\d{4}TILL\\d+$/i)
                        ? [[cell.toUpperCase(), cells[i + 1] ?? '', checked]] : []);
                })'''
            )
        except Error:
            if frame.is_detached():
                continue
            raise
        matched = {name: (stamp, checked) for name, stamp, checked in rows
                   if name.startswith(marker)}
        if matched:
            return matched
    return {}


def newer_success(before, after):
    from datetime import datetime

    try:
        stamp = datetime.strptime(after, '%d/%m/%Y %H:%M:%S')
        return not before or stamp > datetime.strptime(before, '%d/%m/%Y %H:%M:%S')
    except ValueError:
        return False



def run_store(url, marker, preview, progress):
    from playwright.sync_api import Error

    with nebula_session(url, marker, 'MIESZKO_CRM_LOGIN_CODE', progress) as (_, page):
        page.set_default_timeout(10000)
        progress('Opening Utilities > Till Receive')
        button = open_till_receive(page)
        check_store_marker(page.locator('body').inner_text(), marker)
        baseline = wait_for(page, lambda: till_status(page, marker) or None,
                            'Could not read the till rows. Receive was not clicked.',
                            timeout=15000)
        selected = {name: stamp for name, (stamp, checked) in baseline.items() if checked}
        if not selected:
            raise ValueError('Could not verify any selected tills. Receive was not clicked.')
        if preview:
            return f'Receive button found (preview). {len(selected)} selected till(s) verified.'

        dialogs = []

        def record_dialog(dialog):
            dialogs.append(dialog.type)
            dialog.dismiss()

        def completion():
            if dialogs:
                raise ValueError('Nebula displayed a dialog after the click. Check Nebula before rerunning.')
            current = till_status(page, marker)
            if all(newer_success(previous, current.get(name, ('', None))[0])
                   for name, previous in selected.items()):
                return True
            return None

        page.on('dialog', record_dialog)
        try:
            button.click(trial=True, timeout=10000)
        except Error as exc:
            raise ValueError('Receive control was not ready. Receive was not clicked.') from exc
        try:
            button.click(timeout=10000)
        except Error as exc:
            raise ValueError('Click outcome uncertain. Check Nebula before rerunning.') from exc

        progress(f'Receive clicked. Waiting for Last succeed on {len(selected)} selected till(s).')
        try:
            wait_for(page, completion,
                     'Receive clicked, but some Last succeed timestamps did not advance. '
                     'Check Nebula before rerunning.', timeout=120000)
        except Error as exc:
            raise ValueError('Receive clicked, but the status could not be read. Check Nebula before rerunning.') from exc
        return f'Confirmed by Last succeed on all {len(selected)} selected till(s).'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', type=str.upper, help='Ordering store code, e.g. HNS')
    parser.add_argument('--preview', action='store_true', help='Stop before clicking Receive')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]

    try:
        import psycopg

        os.environ.update(runtime_environment(root, os.environ))
        config = json.loads((root / 'automation/config.local.json').read_text(encoding='utf-8-sig'))
        if config.get('store_settings_source') != 'database':
            raise ValueError('Till Receive requires the database-backed CRM Downloads settings')

        with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, connect_timeout=10) as conn:
            stores = conn.execute(
                "SELECT id, code FROM stores WHERE is_active AND erp_type = 'msp' ORDER BY code"
            ).fetchall()
            if args.store:
                stores = [(store_id, code) for store_id, code in stores if code.upper() == args.store]
            if not stores:
                raise ValueError('No active Nebula stores matched')

            failures = 0
            for store_id, code in stores:
                def progress(message):
                    print(f'[{code}] {message}', flush=True)

                try:
                    settings = get_store_config(conn, config, store_id)
                    progress(run_store(settings['crm_url'], crm_store_code(code), args.preview, progress))
                except ValueError as exc:
                    failures += 1
                    progress(f'Failed: {exc}')
                except Exception as exc:
                    failures += 1
                    progress(f'Failed: {type(exc).__name__}. Check the worker and Nebula.')

        print(f'{len(stores) - failures}/{len(stores)} stores processed successfully.')
        return int(failures > 0)
    except (OSError, ValueError) as exc:
        print(exc, file=sys.stderr)
    except Exception as exc:
        print(f'Till Receive could not start or finish ({type(exc).__name__}). Check the worker configuration.',
              file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
