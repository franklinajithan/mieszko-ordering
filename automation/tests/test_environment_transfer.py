"""Reproduce credential transfer through a shell without nested command quotes."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'store-worker-environment.py'
spec = importlib.util.spec_from_file_location('environment_receiver', SOURCE)
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class EnvironmentTransferTests(unittest.TestCase):
    def test_filename_command_survives_removed_shell_quotes_without_executing_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / SOURCE.name
            shutil.copy(SOURCE, script)
            value = 'postgresql://fixture:$(touch SHOULD_NOT_EXIST);&%25@127.0.0.1/mieszko-order'
            result = subprocess.run(['bash', '-c', f'{sys.executable} {script}'],
                                    input=json.dumps({'DATABASE_URL':value}), text=True,
                                    capture_output=True, cwd=folder, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            target = Path(folder) / 'env.local.json'
            self.assertEqual(json.loads(target.read_text()), {'DATABASE_URL':value})
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertFalse((Path(folder) / 'SHOULD_NOT_EXIST').exists())
            self.assertNotIn(value, result.stdout + result.stderr)

    def test_invalid_payload_preserves_existing_credentials_and_never_echoes_input(self):
        for payload in ['not-json-secret', '[]', '{}', '{"DATABASE_URL":""}', '{"DATABASE_URL":"fixture","extra":"secret"}']:
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / 'env.local.json'
                target.write_text('{"DATABASE_URL":"existing"}')
                target.chmod(0o600)
                with self.assertRaises((ValueError, TypeError)):
                    receiver.receive_database_configuration(folder, io.StringIO(payload))
                self.assertEqual(json.loads(target.read_text()), {'DATABASE_URL':'existing'})

    def test_resume_preserves_hidden_crm_login_and_rejects_insecure_environment_file(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'env.local.json'
            target.write_text(json.dumps({'DATABASE_URL':'old', 'MIESZKO_CRM_LOGIN_CODE':'fixture-login'}))
            target.chmod(0o644)
            with self.assertRaises(ValueError):
                receiver.receive_database_configuration(folder, io.StringIO('{"DATABASE_URL":"new"}'))
            target.chmod(0o600)
            receiver.receive_database_configuration(folder, io.StringIO('{"DATABASE_URL":"new"}'))
            self.assertEqual(json.loads(target.read_text()), {'DATABASE_URL':'new','MIESZKO_CRM_LOGIN_CODE':'fixture-login'})
            self.assertEqual(os.listdir(folder), ['env.local.json'])

    def test_failed_cli_transfer_does_not_print_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / SOURCE.name
            shutil.copy(SOURCE, script)
            result = subprocess.run([sys.executable, str(script)], input='fixture-secret-invalid-json',
                                    text=True, capture_output=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('fixture-secret', result.stdout + result.stderr)
            self.assertFalse((Path(folder) / 'env.local.json').exists())
