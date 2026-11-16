"""Fetch native PDFs for one archived daily report date without rerunning imports."""
import argparse
from datetime import date
import fcntl
import json
import os
from pathlib import Path
import re

from linux_worker import runtime_environment
from nebula_download import ConsoleProgress, download
from worker import crm_store_code, get_store_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker-directory', required=True, type=Path)
    parser.add_argument('--date', required=True, type=date.fromisoformat)
    parser.add_argument('--store-id', type=int)
    parser.add_argument('--progress', action='store_true', help='Print the current Nibua step while exporting')
    args = parser.parse_args()

    worker = args.worker_directory.resolve(strict=True)
    os.environ.update(runtime_environment(worker, os.environ))
    config = json.loads((worker / 'automation/config.local.json').read_text(encoding='utf-8-sig'))
    if config.get('store_settings_source') != 'database':
        parser.error('The database-backed Nibua worker is required')
    archive = (worker / config['download_directory']).resolve(strict=True)

    import psycopg
    with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True) as conn:
        reports = conn.execute("""
            SELECT DISTINCT ON (r.store_id) r.store_id, s.name, r.source_file_path
            FROM data_import_runs r JOIN stores s ON s.id=r.store_id
            WHERE r.source_type='wastage' AND r.source_start_date=%s AND r.source_end_date=%s
              AND r.downloaded_at IS NOT NULL AND r.source_file_path IS NOT NULL AND s.is_active
              AND (r.status='success' OR r.details->>'source_sha256' IS NOT NULL)
              AND (%s::integer IS NULL OR r.store_id=%s)
            ORDER BY r.store_id, r.downloaded_at DESC, r.id DESC
        """, (args.date, args.date, args.store_id, args.store_id)).fetchall()
        if not reports:
            print('No eligible archived daily wastage reports found.')
            return 1
        failures = 0
        for store_id, name, source in reports:
            step = 'locating the archived run'
            progress = ConsoleProgress(args.progress)
            try:
                source_path = Path(source)
                relative = source_path.relative_to(archive)
                if not re.fullmatch(r'\d+/report\.(xls|xlsx|csv)', relative.as_posix()):
                    raise ValueError('Invalid archive path')
                folder = source_path.parent
                if folder.resolve(strict=True) != folder:
                    raise ValueError('Invalid archive directory')
                output = folder / 'report.pdf'
                with (folder / '.pdf-backfill.lock').open('a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX)
                    if output.is_file() and not output.is_symlink():
                        with output.open('rb') as stream:
                            if stream.read(5) == b'%PDF-':
                                print(f'{name}: PDF already available', flush=True)
                                continue
                    step = 'loading the store CRM settings'
                    store = get_store_config(conn, config, store_id)
                    day = args.date.isoformat()
                    step = 'exporting the Nibua PDF'
                    print(f'{name}: requesting the native PDF for {day}', flush=True)
                    with progress:
                        download(store['crm_url'], crm_store_code(store['code']), 'wastage', day, day,
                                 output, pdf_only=True, progress=progress)
                    print(f'{name}: PDF saved', flush=True)
            except Exception as error:
                # The browser exception can contain credential-bearing debug context.
                failures += 1
                if step == 'exporting the Nibua PDF':
                    step = progress.stage
                print(f'{name}: PDF unavailable for {args.date} at {step} ({type(error).__name__})', flush=True)
    return int(failures > 0)


if __name__ == '__main__':
    raise SystemExit(main())
