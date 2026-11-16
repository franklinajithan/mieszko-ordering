import importlib.util
from contextlib import redirect_stdout
import io
import json
import tempfile
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch, MagicMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker


def module_file(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).resolve().parents[1] / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RecoveryPolicyTests(unittest.TestCase):
    def test_transient_errors_are_retryable(self):
        for message in ['TimeoutExpired', 'CRM login page is unavailable.', 'Report downloader failed.',
                        'CRM report export failed.', 'Downloader did not produce the requested report',
                        'Worker stopped or timed out', 'ConnectionError']:
            with self.subTest(message=message):
                self.assertEqual(worker.failure_category(message), 'download_retry')
        self.assertEqual(worker.failure_category('private arguments', subprocess.TimeoutExpired(['private'], 1)), 'download_retry')

    def test_validation_and_operator_errors_require_review(self):
        for message in ['CRM displayed another or missing store code', 'CRM login code is missing',
                        'Report parsing failed: Report date differs from requested date',
                        'Report parsing failed: MSP Wastage report says No Records Available.',
                        'CRM daily date controls changed', 'CRM did not retain the Wastage report selection',
                        'Empty report', 'unexpected database error']:
            with self.subTest(message=message):
                self.assertEqual(worker.failure_category(message), 'review_required')
        self.assertEqual(worker.failure_category('Unmatched product'), 'product_review')
        self.assertEqual(worker.failure_category('Invalid rows', worker.ImportValidationError('Invalid rows', {})), 'product_review')
        self.assertEqual(worker.failure_category('Report parsing failed: Report columns not detected'), 'parser_upgrade')

    def test_revision_is_stable_and_content_based(self):
        first = worker.worker_revision()
        self.assertEqual(len(first), 64)
        worker.worker_revision.cache_clear()
        self.assertEqual(worker.worker_revision(), first)

    def test_timer_has_four_london_runs_and_survives_downtime(self):
        config = module_file('configure-linux-worker')
        timer = config.systemd_examples('/srv/app', 'backend')['mieszko-movement-enqueue.timer']
        self.assertEqual(timer.count('OnCalendar='), 4)
        for hour in ('02', '03', '04', '05'):
            self.assertIn(f'OnCalendar=*-*-* {hour}:00:00 Europe/London', timer)
        self.assertIn('Persistent=true', timer)


class HealthCheckTests(unittest.TestCase):
    def setUp(self):
        self.health = module_file('check-linux-worker')

    def test_healthy_services_and_new_timer(self):
        def value(unit, prop):
            return {'ActiveState': 'active', 'UnitFileState': 'enabled', 'WorkingDirectory': '/srv/app',
                    'TimersCalendar': '02:00:00 Europe/London 03:00:00 Europe/London 04:00:00 Europe/London 05:00:00 Europe/London'}[prop]
        with patch.object(self.health, 'systemd_value', side_effect=value):
            self.assertEqual(self.health.check_services('/srv/app', True), [])

    def test_old_release_and_disabled_timer_fail_checks(self):
        with patch.object(self.health, 'systemd_value', return_value='inactive'):
            failures = self.health.check_services('/srv/app', True)
        self.assertEqual(len(failures), 6)
        self.assertTrue(any('different release' in item for item in failures))

    def test_systemctl_timeout_is_bounded_and_read_only(self):
        with patch.object(self.health.subprocess, 'run') as run:
            run.return_value.stdout = 'active\n'
            self.assertEqual(self.health.systemd_value('worker.service', 'ActiveState'), 'active')
            run.assert_called_once_with(['systemctl', 'show', 'worker.service', '--property', 'ActiveState', '--value'], capture_output=True, text=True, timeout=15, check=True)

    def test_health_check_uses_read_only_transaction_and_does_not_expose_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            (app / 'automation').mkdir()
            (app / 'automation/config.local.json').write_text(json.dumps({'stores': {'1': {}}}))
            database = MagicMock()
            conn = database.connect.return_value.__enter__.return_value
            conn.execute.return_value.fetchall.return_value = [('success', 4)]
            conn.execute.return_value.fetchone.return_value = (0,)
            output = io.StringIO()
            with patch.object(self.health, '__file__', str(app / 'automation/check-linux-worker.py')), \
                    patch.object(self.health, 'runtime_environment', return_value={'DATABASE_URL': 'private-dsn'}), \
                    patch.object(self.health, 'check_services', return_value=[]), \
                    patch.object(self.health, 'enabled_movement_sources', return_value=['wastage']), \
                    patch.object(self.health, 'nightly_store_ids', return_value=[1]), \
                    patch.object(self.health, 'require_reconciliation_schema'), \
                    patch.dict(sys.modules, {'psycopg': database}), \
                    patch('sys.argv', ['health', '--require-nightly']), redirect_stdout(output):
                self.assertEqual(self.health.main(), 0)
            conn.execute.assert_any_call('SET TRANSACTION READ ONLY')
            self.assertIn('nightly recovery timer: OK', output.getvalue())
            self.assertNotIn('private-dsn', output.getvalue())

    def test_health_startup_exception_is_redacted(self):
        output = io.StringIO()
        with patch.object(self.health, 'runtime_environment', side_effect=ValueError('private-dsn')), \
                patch('sys.argv', ['health']), redirect_stdout(output):
            self.assertEqual(self.health.main(), 1)
        self.assertNotIn('private-dsn', output.getvalue())
        self.assertIn('could not complete', output.getvalue())
