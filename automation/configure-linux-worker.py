"""Write a disabled-by-default Linux profile and systemd examples. Never activates them."""
import argparse
import json
from pathlib import Path
import re


def build_config(app_dir, verified=False):
    app = Path(app_dir).resolve()
    python = str(app / '.worker-runtime/venv/bin/python')
    command = [python, str(app / 'automation/nebula_download.py'), '--url', '{crm_url}',
               '--store-code', '{store_code}', '--source', '{source}', '--start', '{start}',
               '--end', '{end}', '--output', '{output}']
    return {
        'store_settings_source': 'database',
        'download_directory': str(app / 'automation/downloads'),
        'app_directory': str(app),
        'node_executable': str(app / '.worker-runtime/node/bin/node'),
        'store_defaults': {'feeds': {source: {
            'command': command, 'extension': '.xls', 'timeout_seconds': 2400,
            'mapping': {'code': 'Item Code', 'quantity': 'Quantity'},
            'normalize_with_app_parsers': True, 'complete_store_report': verified,
            'allow_empty_report': False,
        } for source in ('normal_sales', 'rtc', 'wastage')}},
    }


def systemd_examples(app_dir, user):
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*', user):
        raise ValueError('Invalid Linux account name')
    app = str(Path(app_dir).resolve())
    if any(c in app for c in ('"', '\n', '\r', '%', '\\')):
        raise ValueError('Unsupported systemd path characters')
    base = f'''[Unit]
Description=Mieszko daily CRM report worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User={user}
WorkingDirectory={app}
Environment=TZ=Europe/London
UMask=0077
ExecStart="{app}/.worker-runtime/venv/bin/python" "{app}/automation/linux_worker.py"
Restart=on-failure
RestartSec=15
KillMode=mixed
TimeoutStopSec=2500

[Install]
WantedBy=multi-user.target
'''
    nightly = base.replace('Type=simple', 'Type=oneshot').replace('Restart=on-failure\nRestartSec=15\n', '')
    nightly = nightly.replace(f'"{app}/automation/linux_worker.py"', f'"{app}/automation/linux_worker.py" --enqueue-yesterday --enqueue-only')
    nightly = nightly.split('[Install]')[0]
    timer = '''[Unit]
Description=Queue yesterday's separate Normal Sales, RTC and Wastage reports

[Timer]
OnCalendar=*-*-* 02:00:00 Europe/London
Persistent=true
Unit=mieszko-movement-enqueue.service

[Install]
WantedBy=timers.target
'''
    return {'mieszko-import-worker.service': base,
            'mieszko-movement-enqueue.service': nightly,
            'mieszko-movement-enqueue.timer': timer}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-dir', default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument('--user', default='backend')
    parser.add_argument('--verified-reports', action='store_true', help='Use only after office report contracts are verified')
    args = parser.parse_args()
    app = Path(args.app_dir).resolve()
    config = app / 'automation/config.local.json'
    if config.exists():
        raise SystemExit('Existing config.local.json retained. Review it explicitly rather than overwriting it.')
    content = build_config(app, args.verified_reports)
    examples = systemd_examples(app, args.user)
    with config.open('x', encoding='utf-8') as handle:
        json.dump(content, handle, indent=2)
    config.chmod(0o600)
    folder = app / 'automation/systemd.local'
    folder.mkdir(mode=0o700, exist_ok=True)
    for name, text in examples.items():
        path = folder / name
        path.write_text(text)
        path.chmod(0o600)
    print('Profile and systemd examples prepared. No worker or timer installed/started.')
    print('Complete-report verification:', args.verified_reports)
    print('Set DATABASE_URL and MIESZKO_CRM_LOGIN_CODE locally before any controlled run.')


if __name__ == '__main__':
    main()
