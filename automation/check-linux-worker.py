"""Read-only deployment checks; never downloads a report or changes the queue."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from linux_worker import runtime_environment
from worker import enabled_movement_sources, nightly_store_ids, require_reconciliation_schema


def systemd_value(unit, property_name):
    result = subprocess.run(['systemctl', 'show', unit, '--property', property_name, '--value'],
                            capture_output=True, text=True, timeout=15, check=True)
    return result.stdout.strip()


def check_services(app, require_nightly=False):
    failures = []
    unit = 'mieszko-import-worker.service'
    if systemd_value(unit, 'ActiveState') != 'active':
        failures.append('Worker service is not active.')
    if systemd_value(unit, 'UnitFileState') != 'enabled':
        failures.append('Worker service is not enabled for server restarts.')
    if systemd_value(unit, 'WorkingDirectory') != str(Path(app).resolve()):
        failures.append('Worker service points to a different release.')
    if require_nightly:
        timer = 'mieszko-movement-enqueue.timer'
        if systemd_value(timer, 'ActiveState') != 'active' or systemd_value(timer, 'UnitFileState') != 'enabled':
            failures.append('Nightly timer is not active and enabled.')
        schedule = systemd_value(timer, 'TimersCalendar')
        if not all(f'{hour}:00:00' in schedule for hour in ('02', '03', '04', '05')):
            failures.append('Nightly timer does not include all four recovery times; reinstall this release timer.')
        if systemd_value('mieszko-movement-enqueue.service', 'WorkingDirectory') != str(Path(app).resolve()):
            failures.append('Nightly enqueue service points to a different release.')
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-nightly', action='store_true')
    args = parser.parse_args()
    app = Path(__file__).resolve().parent.parent
    try:
        env = runtime_environment(app, os.environ)
        config = json.loads((app / 'automation/config.local.json').read_text())
        feeds = enabled_movement_sources(config)
        failures = check_services(app, args.require_nightly)
        if not feeds:
            failures.append('No verified movement feeds are enabled.')
        import psycopg
        with psycopg.connect(env['DATABASE_URL'], autocommit=True, connect_timeout=10,
                             options='-c statement_timeout=10000') as conn:
            with conn.transaction():
                conn.execute('SET TRANSACTION READ ONLY')
                require_reconciliation_schema(conn)
                stores = nightly_store_ids(conn, config)
                counts = conn.execute("SELECT status,count(*) FROM data_import_runs GROUP BY status ORDER BY status").fetchall()
                stalled = conn.execute("SELECT count(*) FROM data_import_runs WHERE status IN ('downloading','downloaded','importing') AND started_at<now()-interval '2 hours'").fetchone()[0]
        if args.require_nightly and not stores:
            failures.append('No stores are eligible for nightly downloads; enable stores in CRM settings.')
        print('Database connection and required migrations: OK')
        print('Enabled feeds: ' + (', '.join(feeds) or 'none'))
        print(f'Nightly eligible stores: {len(stores)}')
        print('Audit attempts (historical failures remain): ' + ', '.join(f'{status}={count}' for status, count in counts))
        if stalled:
            print(f'ATTENTION: {stalled} attempts active for over two hours. Inspect the worker before clearing abandoned jobs.')
        for failure in failures:
            print('CHECK FAILED: ' + failure)
        if failures:
            return 1
        print('Worker' + (' and nightly recovery timer' if args.require_nightly else '') + ': OK')
        print('Check Download Queue for actual CRM results. Login/report availability requires a real download.')
        return 0
    except Exception:
        # Connection and command exceptions can contain credentials or protected paths.
        print('Health check could not complete. Inspect worker configuration, database access and systemd locally; credentials were not printed.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
