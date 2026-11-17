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


def run_store(url, marker, preview, progress):
    from playwright.sync_api import Error

    with nebula_session(url, marker, 'MIESZKO_CRM_LOGIN_CODE', progress) as (_, page):
        page.set_default_timeout(10000)
        progress('Opening Utilities > Till Receive')
        button = open_till_receive(page)
        check_store_marker(page.locator('body').inner_text(), marker)
        if preview:
            return 'Receive button found (preview)'

        dialogs = []

        def record_dialog(dialog):
            dialogs.append(dialog.type)
            dialog.dismiss()

        page.on('dialog', record_dialog)
        try:
            button.click(timeout=10000)
            page.wait_for_load_state('networkidle', timeout=30000)
        except Error as exc:
            raise ValueError('Receive outcome uncertain. Check Nebula before rerunning.') from exc
        if dialogs:
            raise ValueError('Nebula displayed a dialog. Check the store in Nebula before rerunning.')
        return "Receive clicked. Check 'Last succeed' in Nebula for completion."


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
