"""Explicit office activation. No migrations, web deployment or supplier actions."""
import argparse
import getpass
import json
import os
from pathlib import Path
import subprocess
import tempfile

from worker import crm_store_code
import importlib.util

spec = importlib.util.spec_from_file_location('linux_config', Path(__file__).with_name('configure-linux-worker.py'))
linux_config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linux_config)


def write_private_json(path, value):
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.worker-')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, indent=2)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def verified_config(app, feeds):
    if not feeds or set(feeds) - {'normal_sales', 'rtc', 'wastage'}:
        raise ValueError('Choose verified movement feeds only')
    config = linux_config.build_config(app)
    for source in feeds:
        config['store_defaults']['feeds'][source]['complete_store_report'] = True
    return config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--feeds', nargs='+', choices=['normal_sales', 'rtc', 'wastage'], default=['wastage'])
    parser.add_argument('--start-worker', action='store_true')
    parser.add_argument('--enable-nightly', action='store_true')
    args = parser.parse_args()
    app = Path(__file__).resolve().parent.parent
    try:
        secrets_path = app / 'automation/env.local.json'
        if not secrets_path.exists() or secrets_path.stat().st_mode & 0o077:
            raise ValueError('Supply a protected automation/env.local.json (mode 600) with DATABASE_URL first')
        secrets = json.loads(secrets_path.read_text())
        if set(secrets) - {'DATABASE_URL', 'MIESZKO_CRM_LOGIN_CODE'} or not secrets.get('DATABASE_URL'):
            raise ValueError('Worker credential configuration is incomplete')
        import psycopg
        # Validate this existing office database without changing records or schema.
        with psycopg.connect(secrets['DATABASE_URL'], connect_timeout=10,
                             options='-c default_transaction_read_only=on') as conn:
            if conn.execute('SELECT current_database()').fetchone()[0] != 'mieszko-order':
                raise ValueError('Expected the existing mieszko-order office database; activation cancelled')
            stores = conn.execute('''SELECT s.name,s.code FROM stores s
                JOIN store_crm_settings c ON c.store_id=s.id
                WHERE s.is_active=true AND s.erp_type='msp' ORDER BY s.name''').fetchall()
            if not stores:
                raise ValueError('Save verified CRM store URLs in the app before activation')
            for name, code in stores:
                print(f'Configured store: {name}; CRM marker {crm_store_code(code)}', flush=True)
            queued = conn.execute("SELECT count(*) FROM data_import_runs WHERE status='queued' AND source_type=ANY(%s)", (args.feeds,)).fetchone()[0]
            print(f'{queued} queued jobs in the selected feeds will be eligible for processing.', flush=True)
        if not secrets.get('MIESZKO_CRM_LOGIN_CODE'):
            secrets['MIESZKO_CRM_LOGIN_CODE'] = getpass.getpass('CRM login code (hidden): ').strip()
        if not secrets['MIESZKO_CRM_LOGIN_CODE']:
            raise ValueError('CRM login code is required')
        config_path = app / 'automation/config.local.json'
        if config_path.exists():
            old = json.loads(config_path.read_text())
            if old.get('stores') or old.get('store_settings_source') != 'database':
                raise ValueError('Custom worker profile retained; review it before using this activation tool')
            write_private_json(config_path.with_suffix('.json.before-activation'), old)
        write_private_json(secrets_path, secrets)
        write_private_json(config_path, verified_config(app, args.feeds))
        units = linux_config.systemd_examples(app, getpass.getuser())
        folder = app / 'automation/systemd.local'
        folder.mkdir(mode=0o700, exist_ok=True)
        for name, body in units.items():
            path = folder / name
            path.write_text(body)
            path.chmod(0o600)
        print('Enabled report feeds: ' + ', '.join(args.feeds), flush=True)
        if not (args.start_worker or args.enable_nightly):
            print('Configuration prepared only. No jobs processed and no services started.')
            return 0
        # Validate real unit syntax before replacing installed service definitions.
        subprocess.run(['systemd-analyze', 'verify', *(str(folder / name) for name in units)], check=True)
        names = ['mieszko-import-worker.service'] if args.start_worker else []
        if args.enable_nightly:
            names += ['mieszko-movement-enqueue.service', 'mieszko-movement-enqueue.timer']
        for name in names:
            subprocess.run(['sudo', 'install', '-m', '644', str(folder / name), '/etc/systemd/system/' + name], check=True)
        subprocess.run(['sudo', 'systemctl', 'daemon-reload'], check=True)
        if args.start_worker:
            subprocess.run(['sudo', 'systemctl', 'enable', 'mieszko-import-worker.service'], check=True)
            subprocess.run(['sudo', 'systemctl', 'restart', 'mieszko-import-worker.service'], check=True)
            subprocess.run(['sudo', 'systemctl', 'is-active', '--quiet', 'mieszko-import-worker.service'], check=True)
        if args.enable_nightly:
            subprocess.run(['sudo', 'systemctl', 'enable', '--now', 'mieszko-movement-enqueue.timer'], check=True)
        print('Activation complete. Check CRM Downloads progress and Office Operations. Book Stock remains manual.')
        return 0
    except Exception as error:
        # Do not print raw connection/subprocess errors or a credential-bearing DSN.
        print(str(error) if isinstance(error, ValueError) else 'Activation failed. Check the local database connection, runtime and systemd permissions; credentials were not printed.', flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
