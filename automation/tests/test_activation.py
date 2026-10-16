"""Activation safety tests; no live service, CRM or database is contacted."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import io
from contextlib import redirect_stdout
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location('activation', Path(__file__).resolve().parents[1] / 'activate-linux-worker.py')
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class ActivationTests(unittest.TestCase):
    def run_activation(self, flags=(), fail_connection=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        app = Path(temporary.name)
        (app / 'automation').mkdir()
        activation.write_private_json(app / 'automation/env.local.json', {'DATABASE_URL':'fixture-secret-dsn'})
        database = MagicMock()
        connection = database.connect.return_value.__enter__.return_value
        if fail_connection:
            database.connect.side_effect = RuntimeError('fixture-secret-dsn')
        connection.execute.return_value.fetchone.side_effect = [('mieszko-order',), (3,)]
        connection.execute.return_value.fetchall.return_value = [('Hayes', 'HYS')]
        output = io.StringIO()
        with patch.object(activation, '__file__', str(app / 'automation/activate-linux-worker.py')), \
                patch.dict(sys.modules, {'psycopg': database}), \
                patch('sys.argv', ['activation', *flags]), \
                patch.object(activation.getpass, 'getpass', return_value='fixture-login'), \
                patch.object(activation.getpass, 'getuser', return_value='backend'), \
                patch.object(activation.subprocess, 'run') as commands, redirect_stdout(output):
            status = activation.main()
        return status, commands, output.getvalue(), app

    def test_default_only_prepares_config_without_installing_services(self):
        status, commands, output, app = self.run_activation()
        self.assertEqual(status, 0)
        commands.assert_not_called()
        self.assertTrue((app / 'automation/config.local.json').exists())
        self.assertIn('CRM marker 0665', output)
        self.assertNotIn('fixture-secret-dsn', output)

    def test_explicit_activation_installs_and_starts_only_requested_units(self):
        status, commands, output, app = self.run_activation(['--start-worker', '--enable-nightly'])
        self.assertEqual(status, 0)
        self.assertIn(unittest.mock.call(['sudo', 'systemctl', 'restart', 'mieszko-import-worker.service'], check=True), commands.call_args_list)
        self.assertIn(unittest.mock.call(['sudo', 'systemctl', 'enable', '--now', 'mieszko-movement-enqueue.timer'], check=True), commands.call_args_list)
        self.assertNotIn('fixture-login', output)
        self.assertNotIn('fixture-secret-dsn', output)

    def test_failed_database_preflight_never_enables_config_or_services(self):
        status, commands, output, app = self.run_activation(['--start-worker'], fail_connection=True)
        self.assertEqual(status, 1)
        commands.assert_not_called()
        self.assertFalse((app / 'automation/config.local.json').exists())
        self.assertNotIn('fixture-secret-dsn', output)

    def test_wastage_activation_does_not_enable_other_feeds_or_empty_reports(self):
        config = activation.verified_config('/tmp/example', ['wastage'])
        self.assertEqual(activation.verified_config('/tmp/example', ['wastage']), config)
        self.assertTrue(config['store_defaults']['feeds']['wastage']['complete_store_report'])
        self.assertFalse(config['store_defaults']['feeds']['normal_sales']['complete_store_report'])
        self.assertFalse(config['store_defaults']['feeds']['rtc']['complete_store_report'])
        self.assertNotIn('book_stock', config['store_defaults']['feeds'])
        self.assertTrue(all(not feed['allow_empty_report'] for feed in config['store_defaults']['feeds'].values()))
        for sources in ([], ['book_stock'], ['unknown']):
            with self.assertRaises(ValueError): activation.verified_config('/tmp/example', sources)

    def test_atomic_credential_write_has_private_permissions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'env.local.json'
            activation.write_private_json(path, {'DATABASE_URL':'fixture-only'})
            self.assertEqual(json.loads(path.read_text()), {'DATABASE_URL':'fixture-only'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with patch.object(activation.os, 'replace', side_effect=OSError('fixture')):
                with self.assertRaises(OSError): activation.write_private_json(path, {'DATABASE_URL':'replacement'})
            self.assertEqual(json.loads(path.read_text()), {'DATABASE_URL':'fixture-only'})
            self.assertEqual(os.listdir(folder), ['env.local.json'])
