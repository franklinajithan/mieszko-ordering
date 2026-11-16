from contextlib import contextmanager
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from zipfile import ZipFile

from openpyxl import Workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import report_downloader as downloader


class ReportDownloaderTests(unittest.TestCase):
    def test_report_numbers_are_verified(self):
        pattern = downloader.report_title_pattern('daily_item_volume', downloader.REPORTS['daily_item_volume'][1])
        self.assertTrue(pattern.fullmatch('22. Daily Item Volume'))
        self.assertFalse(pattern.fullmatch('6. Daily Item Volume'))

    def test_reuses_saved_workbook_and_includes_successes_in_partial_zip(self):
        rows = [dict(store=store, report='item_sales', start='2026-10-29', end='2026-11-05',
                     state='waiting', message='') for store in ('STR', 'HNS', 'GRV')]
        launches = []

        @contextmanager
        def session(url, marker, *_):
            launches.append(url)
            if url == 'gravesend':
                raise RuntimeError('CRM fixture unavailable')
            yield Mock(), Mock()

        def export(_context, _page, _frame, source, *_args, **_kwargs):
            Workbook().save(source)

        def update(row, state, message):
            row.update(state=state, message=message)

        with TemporaryDirectory() as directory:
            root = Path(directory)
            cached = downloader.report_path(root, rows[0])
            cached.parent.mkdir(parents=True)
            Workbook().save(cached)
            frame = Mock()
            frame.locator.return_value.inner_text.return_value = 'Selected Report: 6. Item Sales Enquiry'
            fields = {label: Mock() for label in ('From Date', 'To Date')}
            fields['From Date'].input_value.return_value = '29/10/2026'
            fields['To Date'].input_value.return_value = '05/11/2026'
            with patch.object(downloader, 'report_session', session), \
                    patch.object(downloader, 'select_report', return_value=frame), \
                    patch.object(downloader, 'set_dates'), \
                    patch.object(downloader, 'date_input', side_effect=lambda _frame, label: fields[label]), \
                    patch.object(downloader, 'check_store_marker'), \
                    patch.object(downloader, 'export_report', side_effect=export):
                downloader.run_reports(root, {'reports': rows}, {
                    'STR': 'streatham', 'HNS': 'hounslow', 'GRV': 'gravesend',
                }, update)
            self.assertEqual([row['state'] for row in rows], ['skipped', 'completed', 'failed'])
            self.assertNotIn('streatham', launches)
            self.assertEqual(launches.count('gravesend'), 2)
            self.assertTrue(downloader.create_zip(root, root, rows))
            with ZipFile(root / 'reports.zip') as archive:
                self.assertEqual(archive.namelist(), [
                    'Streatham/Item Sales 29.10.26-05.11.26.xlsx',
                    'Hounslow/Item Sales 29.10.26-05.11.26.xlsx',
                ])
                self.assertIsNone(archive.testzip())

    def test_download_names_keep_same_year_workbooks_distinct(self):
        reports = [
            ('rtc', '2025-12-29', '2026-01-02'),
            ('rtc', '2026-01-03', '2026-01-04'),
            ('wastage', '2026-01-03', '2026-01-04'),
            ('wastage', '2026-01-05', '2026-01-06'),
            ('stock_adjustment_extra', '2025-11-15', '2025-11-15'),
            ('daily_item_volume', '2026-11-15', '2026-11-15'),
        ]
        rows = [dict(store='HNS', report=report, start=start, end=end, state='completed')
                for report, start, end in reports]
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for row in rows:
                source = downloader.report_path(root, row)
                source.parent.mkdir(parents=True, exist_ok=True)
                Workbook().save(source)
            self.assertTrue(downloader.create_zip(root, root, rows))
            with ZipFile(root / 'reports.zip') as archive:
                self.assertEqual(archive.namelist(), [
                    'Hounslow/RTC 2025.xlsx',
                    'Hounslow/RTC 2026.xlsx',
                    'Hounslow/wastage/2026-01-03_to_2026-01-04/Wastage 2026.xlsx',
                    'Hounslow/wastage/2026-01-05_to_2026-01-06/Wastage 2026.xlsx',
                    'Hounslow/Wastage 2025.xlsx',
                    'Hounslow/Daily Item Volume 15.11.26-15.11.26.xlsx',
                ])
                self.assertIsNone(archive.testzip())
