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
                    'Streatham/item_sales_2026-10-29_to_2026-11-05.xlsx',
                    'Hounslow/item_sales_2026-10-29_to_2026-11-05.xlsx',
                ])
                self.assertIsNone(archive.testzip())
