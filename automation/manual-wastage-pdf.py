"""Run PDF-only Nibua exports for a selected date and publish progress."""
import argparse
from datetime import date
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time

from linux_worker import runtime_environment
from nebula_download import download
from worker import crm_store_code, get_store_config, london_today


def publish(folder, status):
    status['updatedAt'] = int(time.time() * 1000)
    with tempfile.NamedTemporaryFile(mode='w', dir=folder, delete=False) as stream:
        json.dump(status, stream)
        temporary = Path(stream.name)
    try:
        temporary.replace(folder / 'status.json')
    finally:
        temporary.unlink(missing_ok=True)


def run(args, folder, status, retry_store=None):
    worker = args.worker_directory.resolve(strict=True)
    os.environ.update(runtime_environment(worker, os.environ))
    config = json.loads((worker / 'automation/config.local.json').read_text(encoding='utf-8-sig'))
    if config.get('store_settings_source') != 'database':
        raise ValueError('Database-backed worker required')
    if (worker / config['download_directory']).resolve(strict=True) != args.archive.resolve(strict=True):
        raise ValueError('Archive mismatch')

    import psycopg
    with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True) as conn:
        stores = conn.execute("""
            SELECT s.id, s.name FROM stores s JOIN store_crm_settings c ON c.store_id=s.id
            WHERE s.is_active AND s.erp_type='msp' AND NULLIF(btrim(c.crm_url), '') IS NOT NULL
            ORDER BY s.name, s.id
        """).fetchall()
        if retry_store is None:
            status['stores'] = [{'id': store_id, 'name': name, 'state': 'waiting', 'step': ''}
                                for store_id, name in stores]
            publish(folder, status)
            if not stores:
                status.update(state='failed', message='No active stores have a Nibua address.')
                return
            targets = status['stores']
        elif retry_store['id'] not in dict(stores):
            retry_store.update(state='failed', step='Store no longer has an active Nibua address')
            status.update(state='failed', message='The store PDF could not be retried.')
            return
        else:
            targets = [retry_store]

        day = args.date.isoformat()
        for store in targets:
            store_id = store['id']
            if store_id in args.keep_final:
                store.update(state='complete', step='Final PDF already available')
                publish(folder, status)
                continue

            def progress(step):
                store.update(state='running', step=step)
                publish(folder, status)

            progress('Loading store settings')
            try:
                crm = get_store_config(conn, config, store_id)
                store_folder = folder / str(store_id)
                store_folder.mkdir(exist_ok=True)
                if store_folder.resolve(strict=True) != store_folder:
                    raise ValueError('Invalid store directory')
                output = store_folder / 'report.pdf'
                download(crm['crm_url'], crm_store_code(crm['code']), 'wastage', day, day,
                         output, progress=progress, pdf_only=True)
                store.update(state='complete', step='Fresh PDF saved')
            except Exception as error:
                store.update(state='failed', step=f"{store['step']} ({type(error).__name__})")
            publish(folder, status)
        failed = sum(store['state'] == 'failed' for store in status['stores'])
        status.update(state='failed' if failed else 'complete',
                      message=f'{failed} store(s) could not export a PDF.' if failed else 'All store PDFs are ready.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker-directory', required=True, type=Path)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--date', required=True, type=date.fromisoformat)
    parser.add_argument('--keep-final', type=int, nargs='*', default=[])
    parser.add_argument('--retry-store', type=int)
    args = parser.parse_args()
    if args.date > london_today():
        parser.error('Select today or an earlier date')

    folder = args.archive.resolve(strict=True) / '.manual-pdfs' / args.date.isoformat()
    folder.mkdir(parents=True, exist_ok=True)
    if folder.resolve(strict=True) != folder:
        raise ValueError('Invalid manual archive directory')
    with os.fdopen(os.open(folder / 'run.lock', os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600), 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('ready', flush=True)
            return
        status = {'state': 'running', 'message': 'Preparing the Nibua export.', 'stores': []}
        retry_store = None
        if args.retry_store is not None:
            status_file = folder / 'status.json'
            if status_file.resolve(strict=True) != status_file:
                raise ValueError('Invalid manual export status')
            status = json.loads(status_file.read_text(encoding='utf-8'))
            # The lock is free, so a status still marked running was abandoned.
            if status['state'] == 'running':
                for store in status['stores']:
                    if store['state'] in ('waiting', 'running'):
                        store.update(state='failed', step='Export stopped before the PDF was ready')
            retry_store = next((store for store in status['stores']
                                if store['id'] == args.retry_store and store['state'] == 'failed'), None)
            if retry_store is None:
                print('ready', flush=True)
                return
            retry_store.update(state='waiting', step='Waiting to retry')
            status.update(state='running', message=f"Retrying the PDF export for {retry_store['name']}.")
        publish(folder, status)
        print('ready', flush=True)
        try:
            run(args, folder, status, retry_store)
        except Exception as error:
            message = f'Unable to start the Nibua export ({type(error).__name__}).'
            if retry_store is not None:
                retry_store.update(state='failed', step=message)
            status.update(state='failed', message=message)
        finally:
            publish(folder, status)


if __name__ == '__main__':
    os.umask(0o077)
    main()
