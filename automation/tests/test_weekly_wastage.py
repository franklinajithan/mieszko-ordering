import importlib.util
import subprocess
import sys
import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

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
            for name, expected_cost in [('Hayes', 4), ('Zero', 0)]:
                with (final / name / f'{name}_Wastage_fixture.xlsx').open('rb') as stream:
                    book = load_workbook(stream, data_only=True)
                    self.assertEqual(book['Dept Breakdown']['D2'].value, expected_cost)
                    self.assertEqual(book['RTC']['F2'].value, 0)

    def test_failed_store_is_retried_without_publishing(self):
        with TemporaryDirectory() as temp, patch.object(job, 'process_store', side_effect=RuntimeError) as process:
            root = Path(temp)
            start, end = job.previous_week(date(2026, 11, 16))
            with self.assertRaisesRegex(ValueError, 'Hayes'):
                job.run_week(root, start, end, {'Hayes': ('unused', '0665')})
            self.assertEqual(process.call_count, 3)
            self.assertFalse(list(root.glob('Weekly Waste *')))
