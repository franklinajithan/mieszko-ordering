import fcntl
import importlib.util
import json
import subprocess
import sys
import unittest
from contextlib import closing
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import weekly_wastage_job as job


@unittest.skipUnless(importlib.util.find_spec('pandas'), 'weekly wastage requires pandas')
class WeeklyWastageTest(unittest.TestCase):
    def test_report_period(self):
        self.assertEqual(job.previous_week(date(2026, 11, 16)), (date(2026, 11, 9), date(2026, 11, 15)))
        self.assertEqual(job.previous_week(date(2027, 1, 1)), (date(2026, 12, 21), date(2026, 12, 27)))

    def test_success_with_zero_activity_and_idempotent_rerun(self):
        from openpyxl import Workbook, load_workbook

        def process_fixture(folder, name, url, code, start, end):
            exports = {
                'Wastage': ('Wastage', [['Wastage'], ['No Records Available']] if name == 'Zero' else [
                    ['Item Code', 'Description', 'Item Group', 'Qty', 'Amount', 'Cost'],
                    ['1001', 'Ham', 'DELI', 2, 6, 4],
                ]),
                'RTC': ('RTC', [['Price Override & RTC Sales History'], ['No Records Available']]),
                'Sales': ('Sales', [
                    ['Item Code', 'Description', 'Sales Qty', 'Sales Amt.(Inc. VAT)', 'Cost Value'],
                    ['1001', 'Ham', 10, 30, 20], ['', 'Grand Total', 10, 30, 20],
                ]),
                'Daily_Sales_by_Department': ('Dept', [['Item Group', 'Sales Amt.'], ['Deli', 30]]),
            }
            for kind, (title, rows) in exports.items():
                book = Workbook()
                book.active.title = title
                for row in rows:
                    book.active.append(row)
                book.save(folder / f'{name}_{kind}_fixture.xls')

            result = subprocess.run([
                sys.executable, str(job.APP / 'automation/weekly_wastage/store_workbook.py'),
                '--wastage', str(folder / f'{name}_Wastage_fixture.xls'),
                '--rtc', str(folder / f'{name}_RTC_fixture.xls'),
                '--sales', str(folder / f'{name}_Sales_fixture.xls'),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

        with TemporaryDirectory() as temp, patch.object(job, 'process_store', side_effect=process_fixture) as process:
            root = Path(temp)
            start, end = job.previous_week(date(2026, 11, 16))
            stores = {'Hayes': ('unused', '0665'), 'Zero': ('unused', '0365')}
            job.run_week(root, start, end, stores)
            job.run_week(root, start, end, stores)
            self.assertEqual(process.call_count, 2)
            final = root / 'Weekly Waste 09.11.2026 - 15.11.2026'
            with (final / 'Weekly_Wastage_Summary.xlsx').open('rb') as stream:
                book = load_workbook(stream, data_only=True)
                self.assertIn('Weekly Summary', book.sheetnames)
            summary = final / 'Weekly_Wastage_Summary.xlsx'
            with closing(load_workbook(summary)) as updated:
                sheet = updated['Weekly Summary']
                self.assertEqual((sheet['A7'].value, sheet['B7'].value, sheet['C7'].value),
                                 ('Total Waste %', '=B5/B6', '=C5/C6'))
                self.assertEqual(sheet['B7'].number_format, '0.00%')
                sheet['A7'] = '%'
                sheet['B7'] = 4 / 30
                updated.save(summary)
            job.run_week(root, start, end, stores)
            self.assertEqual(process.call_count, 2)
            with ZipFile(final / 'Weekly_Wastage.zip') as archive:
                with archive.open(summary.name) as stream:
                    repaired = load_workbook(stream)
                    self.assertEqual(repaired['Weekly Summary']['A7'].value, 'Total Waste %')
                    self.assertEqual(repaired['Weekly Summary']['B7'].value, '=B5/B6')
                    repaired.close()
            status = json.loads((root / '.status' / '2026-11-09.json').read_text())
            self.assertEqual(status['state'], 'complete')
            self.assertEqual(status['stores']['Zero']['state'], 'complete')
            with ZipFile(final / 'Weekly_Wastage.zip') as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(len(archive.namelist()), 9)
                self.assertIn('Weekly_Wastage_Summary.xlsx', archive.namelist())
                self.assertIn('Hayes/Hayes_Wastage_fixture.xlsx', archive.namelist())
            for name, expected_cost in [('Hayes', 4), ('Zero', 0)]:
                with (final / name / f'{name}_Wastage_fixture.xlsx').open('rb') as stream:
                    book = load_workbook(stream, data_only=True)
                    self.assertEqual(book['Dept Breakdown']['D2'].value, expected_cost)
                    self.assertEqual(book['RTC']['F2'].value, 0)

    def test_redownload_replaces_a_week_only_after_a_successful_run(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            start, end = job.previous_week(date(2026, 11, 16))
            final = root / 'Weekly Waste 09.11.2026 - 15.11.2026'
            final.mkdir()
            archive = final / 'Weekly_Wastage.zip'
            archive.write_bytes(b'old archive')
            (final / 'Weekly_Wastage_Summary.xlsx').write_bytes(b'old summary')
            stores = {'Hayes': ('unused', '0665'), 'Watford': ('unused', '0602')}

            with (root / '.weekly-wastage.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                with self.assertRaises(BlockingIOError):
                    job.run_week(root, start, end, stores, redownload=True)

            with patch.object(job, 'process_store', side_effect=RuntimeError):
                with self.assertRaisesRegex(ValueError, 'Hayes'):
                    job.run_week(root, start, end, stores, redownload=True)
            self.assertEqual(archive.read_bytes(), b'old archive')
            self.assertEqual((final / 'Weekly_Wastage_Summary.xlsx').read_bytes(), b'old summary')

            def store_fixture(folder, name, *_):
                self.assertEqual(archive.read_bytes(), b'old archive')
                (folder / f'{name}.xlsx').write_bytes(name.encode())

            def summary_fixture(_root, _period, output, *_args, **_kwargs):
                self.assertEqual(archive.read_bytes(), b'old archive')
                output.write_bytes(b'new summary')
                return {}, [], {}, [], {}, []

            with patch.object(job, 'process_store', side_effect=store_fixture) as process, \
                 patch('weekly_wastage.summary_workbook.build_summary', side_effect=summary_fixture):
                job.run_week(root, start, end, stores, redownload=True)
            self.assertEqual(process.call_count, 2)
            with ZipFile(archive) as updated:
                self.assertEqual(updated.read('Weekly_Wastage_Summary.xlsx'), b'new summary')
                self.assertEqual(updated.read('Watford/Watford.xlsx'), b'Watford')
            self.assertFalse(list(root.glob('.weekly-wastage-*/')))

    def test_failed_store_is_retried_without_publishing(self):
        with TemporaryDirectory() as temp, patch.object(job, 'process_store', side_effect=RuntimeError) as process:
            root = Path(temp)
            start, end = job.previous_week(date(2026, 11, 16))
            with self.assertRaisesRegex(ValueError, 'Hayes'):
                job.run_week(root, start, end, {'Hayes': ('unused', '0665')})
            self.assertEqual(process.call_count, 3)
            self.assertFalse(list(root.glob('Weekly Waste *')))
            status = json.loads((root / '.status' / '2026-11-09.json').read_text())
            self.assertEqual(status['state'], 'failed')
            self.assertEqual(status['stores']['Hayes'], {'state': 'failed', 'attempt': 3})
