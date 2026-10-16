"""Systemd-compatible entry point. Starts work only when explicitly executed."""
import json
import os
from pathlib import Path
import subprocess
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
    return env


def main():
    app = Path(__file__).resolve().parent.parent
    allowed = {'--once', '--enqueue-yesterday', '--enqueue-only'}
    if any(arg not in allowed for arg in sys.argv[1:]):
        print('Allowed options: --once --enqueue-yesterday --enqueue-only', file=sys.stderr)
        return 1
    try:
        env = runtime_environment(app, os.environ)
        config = app / 'automation/config.local.json'
        if not config.exists():
            raise ValueError('Run configure-linux-worker.py before starting the worker')
        result = subprocess.run([sys.executable, str(app / 'automation/worker.py'), '--config', str(config), *sys.argv[1:]],
                                cwd=app, env=env, check=False)
        return result.returncode
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Worker startup failed; check the protected local configuration', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
