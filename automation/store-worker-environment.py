"""Receive DATABASE_URL on stdin over SSH, without shell-evaluating credentials."""
import json
import os
from pathlib import Path
import sys
import tempfile


def receive_database_configuration(folder, stream):
    raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError('Configuration payload is too large')
    values = json.loads(raw)
    if (not isinstance(values, dict) or set(values) != {'DATABASE_URL'}
            or not isinstance(values['DATABASE_URL'], str) or not values['DATABASE_URL'].strip()):
        raise ValueError('Expected DATABASE_URL only')
    path = Path(folder) / 'env.local.json'
    if path.exists():
        if path.stat().st_mode & 0o077:
            raise ValueError('Existing worker environment must have mode 600')
        old = json.loads(path.read_text())
        if not isinstance(old, dict) or set(old) - {'DATABASE_URL', 'MIESZKO_CRM_LOGIN_CODE'}:
            raise ValueError('Existing worker environment has unsupported fields')
        if isinstance(old.get('MIESZKO_CRM_LOGIN_CODE'), str) and old['MIESZKO_CRM_LOGIN_CODE'].strip():
            values['MIESZKO_CRM_LOGIN_CODE'] = old['MIESZKO_CRM_LOGIN_CODE']
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.worker-env-')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump(values, handle)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    try:
        receive_database_configuration(Path(__file__).resolve().parent, sys.stdin)
        print('Database configuration stored privately. No imports or services were started.')
        return 0
    except Exception:
        print('Configuration transfer failed. Check the local environment payload and server file permissions; credentials were not printed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
