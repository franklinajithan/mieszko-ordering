"""Systemd-compatible entry point. Starts work only when explicitly executed."""
import json
import argparse
import os
from pathlib import Path
import sys


def runtime_environment(app_dir, inherited):
    app = Path(app_dir).resolve()
    env = dict(inherited)
    secrets = app / 'automation/env.local.json'
    if secrets.exists():
        if secrets.stat().st_mode & 0o077:
            raise ValueError('Protect automation/env.local.json with chmod 600 before running')
        values = json.loads(secrets.read_text())
        if not isinstance(values, dict) or set(values) - {'DATABASE_URL', 'MIESZKO_CRM_LOGIN_CODE'}:
            raise ValueError('The worker secret file accepts only DATABASE_URL and MIESZKO_CRM_LOGIN_CODE')
        if any(not isinstance(v, str) or not v.strip() for v in values.values()):
            raise ValueError('Worker environment values must be non-empty strings')
        env.update(values)
    if not env.get('DATABASE_URL') or not env.get('MIESZKO_CRM_LOGIN_CODE'):
        raise ValueError('Set DATABASE_URL and MIESZKO_CRM_LOGIN_CODE in the protected local environment')
    env['PATH'] = str(app / '.worker-runtime/node/bin') + os.pathsep + env.get('PATH', '')
    env['TZ'] = 'Europe/London'
    env['PYTHONUNBUFFERED'] = '1'
    return env


def main():
    app = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser()
    for flag in ('--once', '--enqueue-yesterday', '--enqueue-only'):
        parser.add_argument(flag, action='store_true')
    parser.add_argument('--max-jobs', type=int)
    parser.add_argument('--store-id', type=int)
    args = parser.parse_args()
    if any(value is not None and value < 1 for value in (args.max_jobs, args.store_id)):
        parser.error('Job limit and store ID must be positive')
    try:
        env = runtime_environment(app, os.environ)
        config = app / 'automation/config.local.json'
        if not config.exists():
            raise ValueError('Run configure-linux-worker.py before starting the worker')
        os.chdir(app)
        os.execve(sys.executable, [sys.executable, str(app / 'automation/worker.py'), '--config', str(config), *sys.argv[1:]], env)
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Worker startup failed; check the protected local configuration', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
