"""Read-only evidence bundle for explicit job IDs. Never starts/stops the worker."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile

DEFAULT_JOBS = [367,346,325,133,130,369,348,327,318,317,135]
SAFE_DETAILS = ['unknown_product_codes','unmatched_barcodes','unmatched_identifier_count',
                'matched_row_count','unmatched_row_count','mapping_type','parse_error',
                'source_sha256','data_sha256','retry_of','reuse_file_of','stage']

def collect(app, output, ids):
    import psycopg
    from psycopg.rows import dict_row
    config = json.loads((app / 'automation/config.local.json').read_text())
    secret_file = app / 'automation/env.local.json'
    url = os.environ.get('DATABASE_URL')
    if secret_file.is_file():
        if secret_file.stat().st_mode & 0o077:
            raise ValueError('Protect the existing worker environment file with mode 600 first')
        url = json.loads(secret_file.read_text()).get('DATABASE_URL', url)
    if not url:
        raise ValueError('DATABASE_URL is unavailable in the existing worker environment')
    root = Path(config['download_directory']).resolve()
    with psycopg.connect(url, row_factory=dict_row, options='-c default_transaction_read_only=on') as conn:
        jobs = conn.execute('''SELECT r.id,r.store_id,s.name AS store_name,r.source_type,r.status,
            r.source_start_date,r.source_end_date,r.downloaded_row_count,r.imported_row_count,
            r.error_message,r.details,r.source_file_path
            FROM data_import_runs r JOIN stores s ON s.id=r.store_id WHERE r.id=ANY(%s) ORDER BY r.id''',(ids,)).fetchall()
        store_ids = sorted({job['store_id'] for job in jobs})
        products = conn.execute('''SELECT sp.id,sp.store_id,sp.store_product_code,p.name
            FROM store_products sp JOIN products p ON p.id=sp.product_id WHERE sp.store_id=ANY(%s) ORDER BY sp.id''',(store_ids,)).fetchall()
        barcodes = conn.execute('SELECT store_id,store_product_id,barcode FROM product_barcodes WHERE store_id=ANY(%s)',(store_ids,)).fetchall()
    manifest = {'missing_job_ids':sorted(set(ids)-{job['id'] for job in jobs}),'jobs':[]}
    # Exclusive create: never overwrite an existing evidence bundle.
    with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED) as archive:
        for job in jobs:
            path = Path(job.pop('source_file_path') or '').resolve()
            job['details'] = {key:value for key,value in (job['details'] or {}).items() if key in SAFE_DETAILS}
            if path.is_relative_to(root) and path.is_file():
                data = path.read_bytes()
                name = f"reports/{job['id']}/report{path.suffix}"
                archive.writestr(name,data)
                job['report'] = name
                job['file_sha256'] = hashlib.sha256(data).hexdigest()
            else:
                job['report_unavailable'] = 'Missing or outside the active download directory; retain the old release downloads for manual collection'
            manifest['jobs'].append(job)
        archive.writestr('jobs.json',json.dumps(manifest,default=str,indent=2))
        archive.writestr('store-products.json',json.dumps(products,default=str,indent=2))
        archive.writestr('barcodes.json',json.dumps(barcodes,default=str,indent=2))
    output.chmod(0o600)
    print(f'Created {output.name}: {len(jobs)} jobs. No database or worker changes.')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--jobs',type=int,nargs='+',default=DEFAULT_JOBS)
    args=parser.parse_args()
    try:
        collect(args.app_dir.resolve(),args.output.resolve(),args.jobs)
    except Exception as error:
        # Database/network exceptions may contain connection strings: never echo them.
        print(str(error) if isinstance(error,ValueError) else f'Evidence collection failed: {type(error).__name__}')
        raise SystemExit(1)
