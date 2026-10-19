"""Office-local queue runner. No scheduling or database migrations occur at startup."""
import argparse
import hashlib
import csv
import json
import os
import subprocess
import time
import signal
import threading
import re
import shutil
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

FEEDS = {
    'normal_sales': ('daily_sales', 'sales_date', 'sold_qty'),
    'rtc': ('rtc_sales', 'rtc_date', 'rtc_qty'),
    'wastage': ('wastage', 'wastage_date', 'wastage_qty'),
    'book_stock': ('book_stock', 'book_stock_date', 'book_stock_qty'),
}

CRM_STORE_CODES = {'HNS': '0365', 'PVL': '0766', 'EAS': '0650', 'HYS': '0665',
                   'GRV': '0566', 'WTF': '0602', 'STR': '0388'}


def crm_store_code(code):
    """Translate the application's store identity to its known CRM login marker."""
    import re
    value = str(code).strip()
    if re.fullmatch(r'\d{4}', value):
        return value
    if value.upper() in CRM_STORE_CODES:
        return CRM_STORE_CODES[value.upper()]
    raise ValueError('Unknown CRM store code; configure a verified store identity before downloading')


def enabled_movement_sources(config):
    if config.get('store_settings_source') != 'database':
        return ['normal_sales', 'rtc', 'wastage']
    feeds = config.get('store_defaults', {}).get('feeds', {})
    return [source for source in ('normal_sales', 'rtc', 'wastage')
            if feeds.get(source, {}).get('complete_store_report') is True]


def london_today():
    return datetime.now(ZoneInfo('Europe/London')).date()


def get_store_config(conn, config, store_id):
    if config.get('store_settings_source') != 'database':
        return config['stores'][str(store_id)]
    row = conn.execute('''SELECT s.code,s.erp_type,c.crm_url FROM stores s
        JOIN store_crm_settings c ON c.store_id=s.id
        WHERE s.id=%s AND s.is_active=true''', (store_id,)).fetchone()
    if not row:
        raise ValueError('Active store CRM settings not found; save the URL in CRM Downloads')
    store = {**config['store_defaults'], **config.get('stores', {}).get(str(store_id), {})}
    # Never cache URLs in the worker: operator edits apply to the next claimed job.
    from urllib.parse import urlsplit
    url = urlsplit(row[2])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('Invalid saved store CRM URL')
    return {**store, 'code': row[0], 'erp': row[1], 'crm_url': row[2]}


def nightly_store_ids(conn, config):
    if config.get('store_settings_source') == 'database':
        return [row[0] for row in conn.execute('''SELECT s.id FROM stores s
            JOIN store_crm_settings c ON c.store_id=s.id
            WHERE s.is_active=true AND s.erp_type='msp' AND c.nightly_enabled=true
            ORDER BY s.id''').fetchall()]
    return [int(key) for key in config['stores']]


class ImportValidationError(ValueError):
    def __init__(self, message, details):
        super().__init__(message)
        self.details = details


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
        text = str(raw).strip()
        if not re.fullmatch(r'[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?', text):
            raise ValueError(f'Row {index}, Qty: invalid decimal quantity')
        qty = Decimal(text.replace(',', ''))
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


def enqueue_nightly(conn, store_ids, day, sources=None):
    """Only the three movement feeds are nightly. Retrying a failed day is explicit."""
    date.fromisoformat(day)
    with conn.transaction():
        for store_id in sorted(set(store_ids)):
            for source in (sources if sources is not None else ('normal_sales', 'rtc', 'wastage')):
                if source not in ('normal_sales', 'rtc', 'wastage'):
                    raise ValueError('Nightly imports support movement feeds only')
                conn.execute('SELECT pg_advisory_xact_lock(73501, %s)', (store_id,))
                conn.execute('''INSERT INTO data_import_runs
                    (store_id, source_type, trigger_type, source_start_date, source_end_date)
                    SELECT %s, %s, 'nightly', %s, %s
                    WHERE EXISTS (SELECT 1 FROM stores WHERE id=%s AND is_active=true)
                    AND NOT EXISTS (SELECT 1 FROM data_import_runs WHERE store_id=%s
                      AND source_type=%s AND source_start_date<=%s AND source_end_date>=%s)''',
                    (store_id, source, day, day, store_id, store_id, source, day, day))


def claim(conn, config=None):
    # Advisory locking during imports serializes writes for a store/source.
    with conn.transaction():
        # Serialize claim selection, not downloads, to close the two-worker overlap race.
        conn.execute('SELECT pg_advisory_xact_lock(73502, 0)')
        if config and config.get('store_settings_source') == 'database':
            # This Nebula profile supports the three movement reports only.
            # Leave manual Book Stock requests for a configured stock downloader.
            return conn.execute('''UPDATE data_import_runs SET status='downloading', started_at=now()
                WHERE id=(SELECT r.id FROM data_import_runs r
                  JOIN stores s ON s.id=r.store_id
                  JOIN store_crm_settings c ON c.store_id=s.id
                  WHERE r.status='queued' AND NOT EXISTS (SELECT 1 FROM data_import_runs busy
                    WHERE busy.id<>r.id AND busy.store_id=r.store_id AND busy.source_type=r.source_type
                    AND busy.status IN ('downloading','downloaded','importing')
                    AND (busy.source_start_date IS NULL OR busy.source_end_date IS NULL OR r.source_start_date IS NULL OR r.source_end_date IS NULL
                      OR (busy.source_start_date<=r.source_end_date AND busy.source_end_date>=r.source_start_date))) AND s.is_active=true AND s.erp_type='msp'
                    AND r.source_type = ANY(%s)
                    AND (%s::int IS NULL OR r.store_id=%s)
                  ORDER BY r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1)
                RETURNING id,store_id,source_type,source_start_date,source_end_date''',
                (enabled_movement_sources(config), config.get('only_store_id'), config.get('only_store_id'))).fetchone()
        return conn.execute('''UPDATE data_import_runs SET status='downloading', started_at=now()
            WHERE id=(SELECT r.id FROM data_import_runs r WHERE r.status='queued'
                AND NOT EXISTS (SELECT 1 FROM data_import_runs busy WHERE busy.id<>r.id
                    AND busy.store_id=r.store_id AND busy.source_type=r.source_type
                    AND busy.status IN ('downloading','downloaded','importing')
                    AND (busy.source_start_date IS NULL OR busy.source_end_date IS NULL OR r.source_start_date IS NULL OR r.source_end_date IS NULL
                      OR (busy.source_start_date<=r.source_end_date AND busy.source_end_date>=r.source_start_date)))
                ORDER BY r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1)
            RETURNING id, store_id, source_type, source_start_date, source_end_date''').fetchone()


def row_fingerprint(rows):
    return hashlib.sha256(json.dumps([(pid, str(day), format(qty.normalize(), 'f'))
        for (pid, day), qty in sorted(rows.items())], separators=(',', ':')).encode()).hexdigest()


def barcode_key(value):
    """Only numeric GTINs have zero-padding equivalence; never strip punctuation."""
    value = str(value).strip()
    if re.fullmatch(r"[0-9]+\.0+", value):
        value = value.split('.')[0]
    if re.fullmatch(r"[0-9]{8,14}", value):
        return value.zfill(14)
    return value


def resolve_identifiers(rows, products, mapping_type, overrides=None):
    indexes = {}
    for code, product_id in products:
        key = barcode_key(code) if mapping_type == 'barcode' else str(code).strip()
        indexes.setdefault(key, set()).add(product_id)
    resolved, unknown = {}, []
    for code in sorted({code for code, _ in rows}):
        key = barcode_key(code) if mapping_type == 'barcode' else code.strip()
        candidates = indexes.get(key, set())
        if len(candidates) == 1:
            resolved[code] = next(iter(candidates))
        elif not candidates and code in (overrides or {}):
            resolved[code] = overrides[code]
        else:
            unknown.append(code)
    return resolved, unknown


def record_stage(conn, run_id, stage, **details):
    details['stage'] = stage
    conn.execute("UPDATE data_import_runs SET details=details || %s::jsonb WHERE id=%s AND status NOT IN ('success','failed')",
                 (json.dumps(details), run_id))


def retained_report(conn, run_id, store_id, source, start, end, root, additional_roots=()):
    entry = conn.execute("SELECT details->>'reuse_file_of' FROM data_import_runs WHERE id=%s", (run_id,)).fetchone()
    if not entry or not entry[0]:
        return None
    old = conn.execute("""SELECT source_file_path,details->>'source_sha256' FROM data_import_runs
        WHERE id=%s AND store_id=%s AND source_type=%s AND source_start_date=%s
        AND source_end_date=%s AND status='failed'""", (int(entry[0]),store_id,source,start,end)).fetchone()
    if not old or not old[0]:
        raise ValueError('Retained report unavailable; request Re-download')
    path = Path(old[0]).resolve()
    roots = [root, *(Path(value).resolve() for value in additional_roots)]
    if not any(path.is_relative_to(allowed) for allowed in roots) or not path.is_file():
        raise ValueError('Retained report is missing or outside the download directory; request Re-download')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if old[1] and old[1] != digest:
        raise ValueError('Retained report checksum changed; request Re-download')
    return path


def match_report(conn, run_id, store_id, rows, mapping_type):
    if mapping_type == 'barcode':
        products = conn.execute('SELECT barcode, store_product_id FROM product_barcodes WHERE store_id=%s', (store_id,)).fetchall()
    elif mapping_type == 'store_product_code':
        products = conn.execute('SELECT store_product_code, id FROM store_products WHERE store_id=%s', (store_id,)).fetchall()
    else:
        raise ValueError('Unsupported product mapping')
    review = conn.execute("SELECT details->'identifier_resolutions' FROM data_import_runs WHERE id=%s", (run_id,)).fetchone()
    approved = review[0] if review and isinstance(review[0], dict) else {}
    valid_ids = {row[0] for row in conn.execute('SELECT id FROM store_products WHERE store_id=%s', (store_id,)).fetchall()}
    overrides = {code: value['store_product_id'] for code, value in approved.items()
                 if isinstance(value, dict) and value.get('store_product_id') in valid_ids and value.get('evidence')}
    products, unknown = resolve_identifiers(rows, products, mapping_type, overrides)
    matched_count = sum(code in products for code, _ in rows)
    unmatched_count = len(rows) - matched_count
    if unknown:
        raise ImportValidationError(f'{len(unknown)} unmatched product identifiers; import cancelled', {
            'unmatched_barcodes' if mapping_type == 'barcode' else 'unknown_product_codes': unknown,
            'unmatched_identifier_count': len(unknown), 'unmatched_row_count': unmatched_count,
            'matched_row_count': matched_count, 'mapping_type': mapping_type})
    return products, matched_count


def import_report(conn, job, rows, filename, mapping_type="store_product_code", source_sha256=None):
    run_id, store_id, source, start, end = job
    table, date_column, quantity_column = FEEDS[source]  # Identifiers only from allowlist.
    with conn.transaction():
        conn.execute('SELECT pg_advisory_xact_lock(73501, %s)', (store_id,))
        state = conn.execute('SELECT status FROM data_import_runs WHERE id=%s FOR UPDATE', (run_id,)).fetchone()
        if not state or state[0] != 'importing':
            raise ValueError('Job is no longer importing')
        products, matched_count = match_report(conn, run_id, store_id, rows, mapping_type)
        resolved = {}
        for (code, day), quantity in rows.items():
            key = (products[code], day)
            resolved[key] = resolved.get(key, Decimal(0)) + quantity
        rows = resolved
        fingerprint = row_fingerprint(rows)
        details = {'data_sha256': fingerprint, 'source_sha256': source_sha256, 'stage': 'completed',
                   'matched_row_count': matched_count, 'unmatched_row_count': 0, 'unmatched_identifier_count': 0}
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
        store = get_store_config(conn, config, store_id)
        identity = conn.execute('SELECT code FROM stores WHERE id=%s AND is_active=true', (store_id,)).fetchone()
        if not identity or (store.get('code') and store['code'] != identity[0]):
            raise ValueError('Configured store identity does not match the database')
        feed = store['feeds'][source]
        if source != 'book_stock' and feed.get('complete_store_report') is not True:
            raise ValueError('Movement imports require complete_store_report=true')
        if source == 'book_stock' and feed.get('includes_negative_stock') is not True:
            raise ValueError('Book Stock report must include negative stock')
        start = str(start or london_today())
        end = str(end or start)
        root = Path(config['download_directory']).resolve()
        retained = retained_report(conn, run_id, store_id, source, start, end, root, config.get('retained_download_directories', []))
        folder = root / str(run_id)
        folder.mkdir(parents=True, exist_ok=False)  # Never reuse an old download.
        extension = feed.get('extension', '.xlsx')
        if extension not in ('.csv', '.xlsx', '.xls') or (extension == '.xls' and not feed.get('normalize_with_app_parsers')):
            raise ValueError('Invalid file extension')
        output = folder / ('report' + extension)
        conn.execute("UPDATE data_import_runs SET source_file_name=%s WHERE id=%s AND status='downloading'", (output.name, run_id))
        values = dict(store_id=str(store_id), store_code=crm_store_code(identity[0]) if config.get('store_settings_source') == 'database' else identity[0], source=source, start=start, end=end, output=str(output), crm_url=store.get('crm_url', ''))
        command = [part.format(**values) for part in feed['command']]
        if retained:
            output = folder / ('report' + retained.suffix)
            shutil.copyfile(retained, output)
            downloaded = subprocess.CompletedProcess([], 0)
        else:
            for attempt in range(3):
                record_stage(conn, run_id, 'downloading', download_attempt=attempt + 1)
                try:
                    downloaded = subprocess.run(command, check=False, timeout=feed.get('timeout_seconds', 2400), shell=False,
                                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                    try:
                        code = json.loads(downloaded.stderr or b'{}').get('error_code')
                    except (ValueError, TypeError, AttributeError):
                        code = None
                    transient = downloaded.returncode != 0 and code in ('login_page', 'network_timeout')
                except subprocess.TimeoutExpired:
                    downloaded = subprocess.CompletedProcess([], 1, stderr=b'{"error_code":"network_timeout"}')
                    transient = True
                if not transient or attempt == 2:
                    break
                delay = min(60, 5 * 2 ** attempt)
                record_stage(conn, run_id, 'retrying', retry_attempt=attempt + 1, retry_delay_seconds=delay)
                conn.execute("UPDATE data_import_runs SET details=jsonb_set(details,'{retry_errors}',COALESCE(details->'retry_errors','[]'::jsonb)||%s::jsonb) WHERE id=%s",
                             (json.dumps([{'attempt': attempt + 1, 'error': 'temporary_crm_failure', 'delay_seconds': delay}]), run_id))
                time.sleep(delay)
                state = conn.execute('SELECT status FROM data_import_runs WHERE id=%s', (run_id,)).fetchone()
                if not state or state[0] != 'downloading':
                    return
                output.unlink(missing_ok=True)
        if downloaded.returncode:
            safe_errors = {
                'wrong_store': 'CRM displayed another or missing store code. Check the saved store URL before retrying.',
                'date_controls': 'CRM daily date controls changed. Verify Date Range, From Date and To Date before retrying.',
                'login_config': 'CRM login code is missing from the server environment.',
                'login_page': 'CRM login page is unavailable. Check the saved store URL and server connectivity.',
                'crm_export': 'CRM report export failed. Verify login, report selection, daily date controls and Excel export.',
                'wastage_report': 'The CRM did not retain the Wastage report selection. Check the report screen before retrying.',
                'wastage_filters': 'The CRM did not retain the requested Wastage day. Check Date Range, From Date and To Date before retrying.',
            }
            try:
                code = json.loads(downloaded.stderr).get('error_code')
            except (ValueError, TypeError, AttributeError):
                code = None
            # Never put arbitrary stderr or credential-bearing command arguments into audit logs.
            raise ValueError(safe_errors.get(code, 'Report downloader failed. Verify the saved CRM URL and server report configuration.'))
        if not output.is_file() or output.stat().st_size == 0:
            raise ValueError('Downloader did not produce the requested report')
        conn.execute("UPDATE data_import_runs SET status='downloaded', downloaded_at=now(), source_file_path=%s, source_start_date=%s, source_end_date=%s WHERE id=%s AND status='downloading'", (str(output), start, end, run_id))
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        conn.execute("UPDATE data_import_runs SET source_file_name=%s,details=details || %s::jsonb WHERE id=%s AND status='downloaded'",
                     (output.name,json.dumps({'source_sha256':digest,'stage':'parsing'}),run_id))
        mapping_type = feed.get('mapping_type', 'store_product_code')
        mapping = feed['mapping']
        raw_rows = None
        if mapping.get('store'):
            # App parsers emit only code/date/quantity. Validate report identity
            # before normalization discards the original store column.
            raw_rows = read_rows(output, mapping)
            if any(str(row.get(mapping['store'], '')).strip() != identity[0] for row in raw_rows):
                raise ValueError('Report contains another store or an unrecognized store marker')
        reasons = {}
        wastage_barcodes = {}
        if feed.get('normalize_with_app_parsers'):
            normalized = folder / 'normalized.json'
            app_dir = Path(config['app_directory']).resolve()
            normalized_result = subprocess.run([config.get('node_executable', 'node'), '--import', 'tsx',
                str(app_dir / 'automation/normalize-report.ts'), '--input', str(output), '--output', str(normalized),
                '--source', source, '--start', start, '--end', end, '--erp', store.get('erp', 'msp')],
                cwd=app_dir, check=False, timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if normalized_result.returncode:
                diagnostic_path = normalized.with_suffix('.error.json')
                diagnostic = json.loads(diagnostic_path.read_text()) if diagnostic_path.is_file() else {}
                message = diagnostic.get('message', 'Parser process failed; check worker dependencies')
                raise ImportValidationError(f'{output.name}: {message}; previous data retained.', {'parse_error': diagnostic, 'stage': 'parsing'})
            envelope = json.loads(normalized.read_text(encoding='utf-8'))
            if envelope.get('source') != source:
                raise ValueError('Normalizer returned the wrong feed')
            reasons = envelope.get('wastage_reasons', {})
            wastage_barcodes = envelope.get('wastage_barcodes', {})
            raw_rows = envelope['rows']
            mapping_type = envelope['mapping_type']
            mapping = {'code': 'Code', 'quantity': 'Qty', 'date': 'Date'}
        elif raw_rows is None:
            raw_rows = read_rows(output, mapping)
        record_stage(conn, run_id, 'matching', mapping_type=mapping_type, wastage_reasons=reasons, wastage_barcodes=wastage_barcodes)
        prepared = prepare_rows(raw_rows, mapping, source, start, end, allow_empty=feed.get("allow_empty_report") is True)
        conn.execute("UPDATE data_import_runs SET downloaded_row_count=%s WHERE id=%s AND status='downloaded'", (len(prepared), run_id))
        _, matched_count = match_report(conn, run_id, store_id, prepared, mapping_type)
        record_stage(conn, run_id, 'importing', matched_row_count=matched_count, unmatched_row_count=0)
        conn.execute("UPDATE data_import_runs SET status='importing', downloaded_row_count=%s WHERE id=%s AND status='downloaded'", (len(prepared), run_id))
        import_report(conn, (run_id, store_id, source, start, end), prepared, output.name, mapping_type, hashlib.sha256(output.read_bytes()).hexdigest())
        print(f'Job {run_id}: success ({len(prepared)} rows)', flush=True)
    except Exception as exc:
        # Keep credentials/command arguments out of logs and dashboard errors.
        message = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        conn.execute("UPDATE data_import_runs SET status='failed', completed_at=now(), error_message=%s, details=details || %s::jsonb WHERE id=%s AND status NOT IN ('success','failed')", (message[:2000], json.dumps(exc.details if isinstance(exc, ImportValidationError) else {}), run_id))
        print(f'Job {run_id}: failed ({message})', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--max-jobs', type=int, help='Stop after this many queued jobs (successes or failures)')
    parser.add_argument('--store-id', type=int, help='Restrict a controlled database-backed run to one store')
    parser.add_argument('--retry-run', type=int, help='Create a new attempt for a failed run')
    parser.add_argument('--fail-stalled-minutes', type=int, help='Explicitly fail abandoned runs after stopping other workers')
    parser.add_argument('--enqueue-date', help='Queue all three movement feeds for YYYY-MM-DD')
    parser.add_argument('--enqueue-yesterday', action='store_true')
    parser.add_argument('--enqueue-only', action='store_true', help='Queue daily reports without consuming any jobs')
    args = parser.parse_args()
    if args.max_jobs is not None and args.max_jobs < 1:
        parser.error('--max-jobs must be positive')
    if args.store_id is not None and args.store_id < 1:
        parser.error('--store-id must be positive')
    if args.enqueue_only and not (args.enqueue_date or args.enqueue_yesterday):
        parser.error('--enqueue-only requires --enqueue-date or --enqueue-yesterday')
    config = json.loads(Path(args.config).read_text(encoding='utf-8-sig'))
    if args.store_id is not None:
        if config.get('store_settings_source') != 'database':
            parser.error('--store-id requires the database-backed profile')
        config['only_store_id'] = args.store_id
    import psycopg
    with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True, prepare_threshold=None) as conn:
        if args.fail_stalled_minutes:
            if args.fail_stalled_minutes < 60:
                raise ValueError('Stalled timeout must be at least 60 minutes')
            conn.execute("UPDATE data_import_runs SET status='failed', completed_at=now(), error_message='Worker stopped or timed out' WHERE status IN ('downloading','downloaded','importing') AND started_at < now()-(%s * interval '1 minute')", (args.fail_stalled_minutes,))
        if args.retry_run:
            with conn.transaction():
                identity = conn.execute("SELECT store_id FROM data_import_runs WHERE id=%s", (args.retry_run,)).fetchone()
                if not identity:
                    raise ValueError('Failed import run not found')
                conn.execute('SELECT pg_advisory_xact_lock(73501, %s)', (identity[0],))
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
            day = args.enqueue_date or str(london_today() - timedelta(days=1))
            ids = nightly_store_ids(conn, config)
            if args.store_id is not None:
                ids = [store_id for store_id in ids if store_id == args.store_id]
            enqueue_nightly(conn, ids, day, enabled_movement_sources(config))
        if args.enqueue_only:
            return
        processed = 0
        stopping = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stopping.set())
        while not stopping.is_set():
            job = claim(conn, config)
            if job:
                process_job(conn, config, job)
                processed += 1
                if args.max_jobs is not None and processed >= args.max_jobs:
                    break
            elif args.once:
                break
            else:
                stopping.wait(10)


if __name__ == '__main__':
    main()
