"""Office-local queue runner. No scheduling or database migrations occur at startup."""
import argparse
import hashlib
import csv
import json
import os
import subprocess
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

FEEDS = {
    'normal_sales': ('daily_sales', 'sales_date', 'sold_qty'),
    'rtc': ('rtc_sales', 'rtc_date', 'rtc_qty'),
    'wastage': ('wastage', 'wastage_date', 'wastage_qty'),
    'book_stock': ('book_stock', 'book_stock_date', 'book_stock_qty'),
}


def prepare_rows(rows, mapping, source, start, end, allow_empty=False):
    """Strict file validation before any writes; repeated product/date lines sum."""
    if source not in FEEDS:
        raise ValueError('Unknown source')
    start, end = date.fromisoformat(start), date.fromisoformat(end)
    if start > end or (source == 'book_stock' and start != end):
        raise ValueError('Invalid report date range')
    result = {}
    for index, row in enumerate(rows, 2):
        code = str(row.get(mapping['code'], '')).strip()
        raw = row.get(mapping['quantity'])
        if not code or raw is None or str(raw).strip() == '':
            raise ValueError(f'Row {index}: missing code or quantity')
        qty = Decimal(str(raw).replace(',', '').strip())
        if not qty.is_finite() or abs(qty) >= Decimal('100000000000000'):
            raise ValueError(f'Row {index}: invalid quantity')
        if qty != qty.quantize(Decimal('0.0001')):
            raise ValueError(f'Row {index}: more than four decimal places')
        value = row.get(mapping.get('date', ''))
        if isinstance(value, datetime):
            value = value.date().isoformat()
        if not value and start != end:
            raise ValueError(f'Row {index}: daily date required for multi-day reports')
        day = date.fromisoformat(str(value or start))
        if not start <= day <= end:
            raise ValueError(f'Row {index}: date outside requested range')
        if source in ('rtc', 'wastage') and qty < 0:
            raise ValueError(f'Row {index}: expected positive movement quantity')
        key = (code, day)
        result[key] = result.get(key, Decimal(0)) + qty
    if not result and not (allow_empty and source != 'book_stock'):
        raise ValueError('Empty report; previous data retained')
    return result


def read_rows(path, mapping):
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as handle:
            return list(csv.DictReader(handle))
    if path.suffix.lower() != '.xlsx':
        raise ValueError('Expected CSV or XLSX report')
    from openpyxl import load_workbook
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = book[mapping['sheet']] if mapping.get('sheet') else book.active
        iterator = sheet.iter_rows(min_row=mapping.get('header_row', 1), values_only=True)
        headers = [str(value).strip() if value is not None else '' for value in next(iterator)]
        return [dict(zip(headers, row)) for row in iterator if any(v is not None for v in row)]
    finally:
        book.close()


def enqueue_nightly(conn, store_ids, day):
    """Only the three movement feeds are nightly. Retrying a failed day is explicit."""
    date.fromisoformat(day)
    with conn.transaction():
        for store_id in store_ids:
            for source in ('normal_sales', 'rtc', 'wastage'):
                conn.execute('SELECT pg_advisory_xact_lock(73501, %s)', (store_id,))
                conn.execute('''INSERT INTO data_import_runs
                    (store_id, source_type, trigger_type, source_start_date, source_end_date)
                    SELECT %s, %s, 'nightly', %s, %s
                    WHERE EXISTS (SELECT 1 FROM stores WHERE id=%s AND is_active=true)
                    AND NOT EXISTS (SELECT 1 FROM data_import_runs WHERE store_id=%s
                      AND source_type=%s AND source_start_date=%s AND trigger_type='nightly')''',
                    (store_id, source, day, day, store_id, store_id, source, day))


def claim(conn):
    # Advisory locking during imports serializes writes for a store/source.
    with conn.transaction():
        return conn.execute('''UPDATE data_import_runs SET status='downloading', started_at=now()
            WHERE id=(SELECT id FROM data_import_runs WHERE status='queued'
                ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING id, store_id, source_type, source_start_date, source_end_date''').fetchone()


def row_fingerprint(rows):
    return hashlib.sha256(json.dumps([(pid, str(day), format(qty.normalize(), 'f'))
        for (pid, day), qty in sorted(rows.items())], separators=(',', ':')).encode()).hexdigest()


def import_report(conn, job, rows, filename, mapping_type="store_product_code", source_sha256=None):
    run_id, store_id, source, start, end = job
    table, date_column, quantity_column = FEEDS[source]  # Identifiers only from allowlist.
    with conn.transaction():
        conn.execute('SELECT pg_advisory_xact_lock(73501, %s)', (store_id,))
        state = conn.execute('SELECT status FROM data_import_runs WHERE id=%s FOR UPDATE', (run_id,)).fetchone()
        if not state or state[0] != 'importing':
            raise ValueError('Job is no longer importing')
        if mapping_type == 'barcode':
            products = dict(conn.execute('SELECT barcode, store_product_id FROM product_barcodes WHERE store_id=%s', (store_id,)).fetchall())
        elif mapping_type == 'store_product_code':
            products = dict(conn.execute('SELECT store_product_code, id FROM store_products WHERE store_id=%s', (store_id,)).fetchall())
        else:
            raise ValueError('Unsupported product mapping')
        unknown = sorted({code for code, _ in rows if code not in products})
        if unknown:
            raise ValueError(f'{len(unknown)} unmatched product codes; import cancelled')
        resolved = {}
        for (code, day), quantity in rows.items():
            key = (products[code], day)
            resolved[key] = resolved.get(key, Decimal(0)) + quantity
        rows = resolved
        fingerprint = row_fingerprint(rows)
        details = {'data_sha256': fingerprint, 'source_sha256': source_sha256}
        # Only the latest overlapping import describes the current database state.
        # An older matching fingerprint must not suppress a legitimate correction.
        previous = conn.execute("""SELECT id, imported_at, details->>'data_sha256', details->>'duplicate_of'
            FROM data_import_runs WHERE store_id=%s AND source_type=%s
            AND source_start_date<=%s AND source_end_date>=%s AND status='success'
            ORDER BY imported_at DESC NULLS LAST, id DESC LIMIT 1""",
            (store_id, source, end, start)).fetchone()
        unchanged = previous and previous[2] == fingerprint
        if unchanged and source == 'book_stock':
            # Browser uploads need not have a worker audit row. A newer manual
            # snapshot invalidates the previous worker fingerprint.
            latest = conn.execute("""SELECT max(imported_at) FROM book_stock WHERE
                store_product_id IN (SELECT id FROM store_products WHERE store_id=%s)""", (store_id,)).fetchone()[0]
            unchanged = latest == previous[1]
        elif unchanged:
            # Likewise, manual movement imports can change this range without
            # changing the worker audit history. Compare the stored data too.
            current = conn.execute(f'SELECT store_product_id,{date_column},{quantity_column} FROM {table} '
                f'WHERE {date_column} BETWEEN %s AND %s AND store_product_id IN '
                '(SELECT id FROM store_products WHERE store_id=%s)', (start, end, store_id)).fetchall()
            unchanged = row_fingerprint({(pid, day): qty for pid, day, qty in current}) == fingerprint
        if unchanged:
            details['duplicate_of'] = int(previous[3]) if previous[3] else previous[0]
            conn.execute("""UPDATE data_import_runs SET status='success', imported_at=%s, completed_at=now(),
                imported_row_count=0, rejected_row_count=0, source_file_name=%s, details=details || %s::jsonb WHERE id=%s""",
                (previous[1], filename, json.dumps(details), run_id))
            return
        imported_at = conn.execute('SELECT clock_timestamp()').fetchone()[0]
        if source == 'book_stock':
            # One snapshot timestamp, committed atomically with the successful audit record.
            for (product_id, day), quantity in rows.items():
                conn.execute('''INSERT INTO book_stock (store_product_id, book_stock_date, book_stock_qty, imported_at)
                    VALUES (%s,%s,%s,%s)''', (product_id, day, quantity, imported_at))
            conn.execute('DELETE FROM not_posted_deliveries WHERE store_product_id IN (SELECT id FROM store_products WHERE store_id=%s)', (store_id,))
        else:
            # Reports must cover the whole store/day. Replace the requested range to remove
            # corrected/deleted lines on retry, without touching the other two feeds.
            conn.execute(f'DELETE FROM {table} WHERE {date_column} BETWEEN %s AND %s AND store_product_id IN (SELECT id FROM store_products WHERE store_id=%s)', (start, end, store_id))
            for (product_id, day), quantity in rows.items():
                conn.execute(f'INSERT INTO {table} (store_product_id,{date_column},{quantity_column}) VALUES (%s,%s,%s)', (product_id, day, quantity))
        conn.execute('''UPDATE data_import_runs SET status='success', imported_at=%s, completed_at=now(),
            imported_row_count=%s, rejected_row_count=0, source_file_name=%s, details=details || %s::jsonb WHERE id=%s''',
            (imported_at, len(rows), filename, json.dumps(details), run_id))


def process_job(conn, config, job):
    run_id, store_id, source, start, end = job
    try:
        store = config['stores'][str(store_id)]
        identity = conn.execute('SELECT code FROM stores WHERE id=%s AND is_active=true', (store_id,)).fetchone()
        if not identity or (store.get('code') and store['code'] != identity[0]):
            raise ValueError('Configured store identity does not match the database')
        feed = store['feeds'][source]
        if source != 'book_stock' and feed.get('complete_store_report') is not True:
            raise ValueError('Movement imports require complete_store_report=true')
        if source == 'book_stock' and feed.get('includes_negative_stock') is not True:
            raise ValueError('Book Stock report must include negative stock')
        start = str(start or date.today())
        end = str(end or start)
        folder = Path(config['download_directory']).resolve() / str(run_id)
        folder.mkdir(parents=True, exist_ok=False)  # Never reuse an old download.
        extension = feed.get('extension', '.xlsx')
        if extension not in ('.csv', '.xlsx'):
            raise ValueError('Invalid file extension')
        output = folder / ('report' + extension)
        values = dict(store_id=str(store_id), source=source, start=start, end=end, output=str(output))
        command = [part.format(**values) for part in feed['command']]
        subprocess.run(command, check=True, timeout=feed.get('timeout_seconds', 2400), shell=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not output.is_file() or output.stat().st_size == 0:
            raise ValueError('Downloader did not produce the requested report')
        conn.execute("UPDATE data_import_runs SET status='downloaded', downloaded_at=now(), source_file_path=%s, source_start_date=%s, source_end_date=%s WHERE id=%s AND status='downloading'", (str(output), start, end, run_id))
        mapping_type = feed.get('mapping_type', 'store_product_code')
        mapping = feed['mapping']
        raw_rows = None
        if mapping.get('store'):
            # App parsers emit only code/date/quantity. Validate report identity
            # before normalization discards the original store column.
            raw_rows = read_rows(output, mapping)
            if any(str(row.get(mapping['store'], '')).strip() != identity[0] for row in raw_rows):
                raise ValueError('Report contains another store or an unrecognized store marker')
        if feed.get('normalize_with_app_parsers'):
            normalized = folder / 'normalized.json'
            app_dir = Path(config['app_directory']).resolve()
            subprocess.run([config.get('node_executable', 'node'), '--import', 'tsx',
                str(app_dir / 'automation/normalize-report.ts'), '--input', str(output), '--output', str(normalized),
                '--source', source, '--start', start, '--end', end, '--erp', store.get('erp', 'msp')],
                cwd=app_dir, check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            envelope = json.loads(normalized.read_text(encoding='utf-8'))
            if envelope.get('source') != source:
                raise ValueError('Normalizer returned the wrong feed')
            raw_rows = envelope['rows']
            mapping_type = envelope['mapping_type']
            mapping = {'code': 'Code', 'quantity': 'Qty', 'date': 'Date'}
        elif raw_rows is None:
            raw_rows = read_rows(output, mapping)
        prepared = prepare_rows(raw_rows, mapping, source, start, end, allow_empty=feed.get("allow_empty_report") is True)
        conn.execute("UPDATE data_import_runs SET status='importing', downloaded_row_count=%s WHERE id=%s AND status='downloaded'", (len(prepared), run_id))
        import_report(conn, (run_id, store_id, source, start, end), prepared, output.name, mapping_type, hashlib.sha256(output.read_bytes()).hexdigest())
        print(f'Job {run_id}: success ({len(prepared)} rows)', flush=True)
    except Exception as exc:
        # Keep credentials/command arguments out of logs and dashboard errors.
        message = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        conn.execute("UPDATE data_import_runs SET status='failed', completed_at=now(), error_message=%s WHERE id=%s AND status NOT IN ('success','failed')", (message[:2000], run_id))
        print(f'Job {run_id}: failed ({message})', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--retry-run', type=int, help='Create a new attempt for a failed run')
    parser.add_argument('--fail-stalled-minutes', type=int, help='Explicitly fail abandoned runs after stopping other workers')
    parser.add_argument('--enqueue-date', help='Queue all three movement feeds for YYYY-MM-DD')
    parser.add_argument('--enqueue-yesterday', action='store_true')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
    import psycopg
    with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, prepare_threshold=None) as conn:
        if args.fail_stalled_minutes:
            if args.fail_stalled_minutes < 60:
                raise ValueError('Stalled timeout must be at least 60 minutes')
            conn.execute("UPDATE data_import_runs SET status='failed', completed_at=now(), error_message='Worker stopped or timed out' WHERE status IN ('downloading','downloaded','importing') AND started_at < now()-(%s * interval '1 minute')", (args.fail_stalled_minutes,))
        if args.retry_run:
            with conn.transaction():
                failed = conn.execute("SELECT store_id,source_type,source_start_date,source_end_date FROM data_import_runs WHERE id=%s AND status='failed' FOR UPDATE", (args.retry_run,)).fetchone()
                if not failed:
                    raise ValueError('Failed import run not found')
                store_id, source, start, end = failed
                conn.execute('SELECT pg_advisory_xact_lock(73501, %s)', (store_id,))
                active = conn.execute("SELECT id FROM data_import_runs WHERE store_id=%s AND source_type=%s AND status IN ('queued','downloading','downloaded','importing')", (store_id, source)).fetchone()
                if active:
                    raise ValueError('A run for this store/feed is already active')
                conn.execute("INSERT INTO data_import_runs(store_id,source_type,source_start_date,source_end_date,trigger_type,details) VALUES(%s,%s,%s,%s,'retry',%s::jsonb)", (store_id,source,start,end,json.dumps({'retry_of':args.retry_run})))
        if args.enqueue_date or args.enqueue_yesterday:
            day = args.enqueue_date or str(date.today() - timedelta(days=1))
            enqueue_nightly(conn, [int(key) for key in config['stores']], day)
        while True:
            job = claim(conn)
            if job:
                process_job(conn, config, job)
            elif args.once:
                break
            else:
                time.sleep(10)


if __name__ == '__main__':
    main()
