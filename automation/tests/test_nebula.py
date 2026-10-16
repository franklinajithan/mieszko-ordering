import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import os
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('nebula_download', Path(__file__).resolve().parents[1] / 'nebula_download.py')
nebula = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nebula)
config_spec = importlib.util.spec_from_file_location('linux_config', Path(__file__).resolve().parents[1] / 'configure-linux-worker.py')
config_module = importlib.util.module_from_spec(config_spec)
config_spec.loader.exec_module(config_module)
runtime_spec = importlib.util.spec_from_file_location('linux_runtime', Path(__file__).resolve().parents[1] / 'linux_worker.py')
runtime_module = importlib.util.module_from_spec(runtime_spec)
runtime_spec.loader.exec_module(runtime_module)


class NebulaContractsTests(unittest.TestCase):
    def test_date_fields_ignore_hidden_duplicates_but_reject_visible_ambiguity(self):
        for name in ('From Date', 'To Date'):
            hidden = Mock()
            hidden.is_visible.return_value = False
            field = Mock()
            field.is_visible.return_value = True
            matches = Mock()
            matches.count.return_value = 3
            matches.nth.side_effect = lambda index: [hidden, field, hidden][index]
            frame = Mock()
            frame.get_by_label.return_value = matches
            self.assertIs(nebula.date_input(frame, name), field)
            frame.get_by_text.assert_not_called()
            matches.nth.side_effect = lambda index: [hidden, field, field][index]
            with self.assertRaises(nebula.CrmExportError) as error:
                nebula.date_input(frame, name)
            self.assertEqual(error.exception.code, 'date_controls')

    def test_interactive_test_keeps_login_out_of_command_arguments(self):
        args = ['nebula_download.py', '--prompt-login', '--url', 'http://127.0.0.1/', '--store-code', '0665',
                '--source', 'normal_sales', '--start', '2026-10-15', '--end', '2026-10-15', '--output', '/tmp/report.xls']
        with patch('sys.argv', args), patch.dict(os.environ, {}, clear=True), \
                patch.object(nebula.getpass, 'getpass', return_value='fixture-only'), patch.object(nebula, 'download') as download:
            self.assertEqual(nebula.main(), 0)
            self.assertEqual(os.environ['MIESZKO_CRM_LOGIN_CODE'], 'fixture-only')
            self.assertNotIn('fixture-only', str(download.call_args))

    def test_normal_sales_accepts_known_nebula_names_but_never_aggregate_reports(self):
        pattern = nebula.report_title_pattern('normal_sales', 'Product Sales Enquiry')
        for title in ['Product Sales Enquiry', '6. Product Sales Enquiry', 'Item Sales Enquiry', '6. Item Sales Enquiry']:
            self.assertIsNotNone(pattern.fullmatch(title))
        for title in ['Daily Sales by Department', 'Daily Item Volume', 'Item Sales Enquiry Summary', 'RTC Item Sales Enquiry']:
            self.assertIsNone(pattern.fullmatch(title))
        self.assertIsNone(nebula.report_title_pattern('rtc', 'Price Override & RTC Sales History').fullmatch('Item Sales Enquiry'))

    def test_requested_dates_are_one_real_day_not_a_weekly_period(self):
        self.assertEqual(nebula.requested_day('2026-10-15', '2026-10-15'), '15/10/2026')
        for start, end in [('2026-10-01','2026-10-07'), ('2026-02-30','2026-02-30'), ('2026-1-1','2026-1-1')]:
            with self.assertRaises(ValueError): nebula.requested_day(start, end)

    def test_store_identity_never_accepts_another_or_missing_store(self):
        nebula.check_store_marker('Store Info: 0665 | Mieszko Hayes', '0665')
        for body in ['Store Info: 0365 | Mieszko Hounslow', 'Sales report', 'Store Info: 0665 Store Info: 0365']:
            with self.assertRaises(ValueError): nebula.check_store_marker(body, '0665')

    def test_urls_cannot_contain_credentials(self):
        self.assertEqual(nebula.checked_url('http://192.168.1.5:1910/'), 'http://192.168.1.5:1910/')
        for value in ['file:///etc/passwd', 'http://u:p@host/', 'http://host/?token=secret']:
            with self.assertRaises(ValueError): nebula.checked_url(value)

    def test_linux_profile_excludes_book_stock_and_requires_report_verification(self):
        config = config_module.build_config('/tmp/example')
        self.assertEqual(set(config['store_defaults']['feeds']), {'normal_sales','rtc','wastage'})
        self.assertTrue(all(not f['complete_store_report'] for f in config['store_defaults']['feeds'].values()))
        self.assertTrue(all(f['complete_store_report'] for f in config_module.build_config('/tmp/example', True)['store_defaults']['feeds'].values()))
        units = config_module.systemd_examples('/tmp/example', 'backend')
        self.assertIn('02:00:00 Europe/London', units['mieszko-movement-enqueue.timer'])
        self.assertIn('--enqueue-yesterday --enqueue-only', units['mieszko-movement-enqueue.service'])
        self.assertNotIn('--enqueue-yesterday', units['mieszko-import-worker.service'])

    def test_runtime_credentials_are_protected_and_never_shell_evaluated(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            (app / 'automation').mkdir()
            secrets = app / 'automation/env.local.json'
            values = {'DATABASE_URL':'postgresql://fixture:fixture@127.0.0.1/test','MIESZKO_CRM_LOGIN_CODE':'$(not-executed)'}
            secrets.write_text(json.dumps(values))
            secrets.chmod(0o644)
            with self.assertRaises(ValueError): runtime_module.runtime_environment(app, {})
            secrets.chmod(0o600)
            env = runtime_module.runtime_environment(app, {'PATH':'/usr/bin'})
            self.assertEqual(env['MIESZKO_CRM_LOGIN_CODE'], '$(not-executed)')
            self.assertTrue(env['PATH'].startswith(str(app / '.worker-runtime/node/bin')))


if __name__ == '__main__': unittest.main()
