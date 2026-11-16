from contextlib import contextmanager
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import item_sales_enquiry as report6


class Report6Tests(unittest.TestCase):
    def test_report_selection_requires_number_six(self):
        pattern = report6.report_title_pattern(report6.SOURCE, report6.TITLE)
        self.assertTrue(pattern.fullmatch('6. Item Sales Enquiry'))
        for title in ('22. Item Sales Enquiry', '22. Daily Item Volume', 'Item Sales Enquiry'):
            self.assertFalse(pattern.fullmatch(title))

    def test_native_excel_is_detected_without_an_extension(self):
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, final = root / 'download', root / 'final.xlsx'
            Workbook().save(raw)
            report6.publish_workbook(raw, final)
            self.assertTrue(report6.valid_xlsx(final))
            raw.write_bytes(b'<html>Login expired</html>')
            with self.assertRaises(report6.WorkbookError):
                report6.publish_workbook(raw, final)
            self.assertTrue(report6.valid_xlsx(final))

    def test_legacy_export_runs_calc_and_validates_conversion(self):
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw, final = root / 'download', root / 'final.xlsx'
            raw.write_bytes(report6.XLS_SIGNATURE + b'legacy fixture')

            def convert(command, **kwargs):
                self.assertEqual(Path(command[-1]).suffix, '.xls')
                Workbook().save(root / 'download.xlsx')
                return Mock(returncode=0)

            with patch.object(report6.shutil, 'which', return_value='/usr/bin/libreoffice'), \
                    patch.object(report6.subprocess, 'run', side_effect=convert):
                report6.publish_workbook(raw, final)
            self.assertTrue(report6.valid_xlsx(final))

    def test_store_order_session_reuse_and_continue_after_error(self):
        from openpyxl import Workbook
        stores = list(report6.STORES)
        rows = [{'store': store, 'date': day, 'state': 'waiting', 'message': ''}
                for store in reversed(stores) for day in ('2026-11-11', '2026-11-12')]
        events = []

        @contextmanager
        def session(url, marker, login_env, progress):
            events.append(('open', marker))
            yield Mock(), Mock()
            events.append(('close', marker))

        def export(context, page, day, marker, source, progress):
            events.append(('export', marker, day.isoformat()))
            if marker == report6.CRM_STORE_CODES['STR'] and day.day == 11:
                raise RuntimeError('fixture failure')
            Workbook().save(source)

        conn = Mock()
        conn.execute.return_value = list(enumerate(stores, 1))
        settings = {'crm_url': 'http://example.test/'}
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(report6, 'get_store_config', return_value=settings), \
                patch.object(report6, 'report_session', session), \
                patch.object(report6, 'select_report'), patch.object(report6, 'export_day', export):
            root = Path(directory)
            report6.run_reports(root, root, {'reports': rows, 'force': False}, {}, conn)

        order = list(dict.fromkeys(event[1] for event in events if event[0] == 'export'))
        self.assertEqual(order, [report6.CRM_STORE_CODES[store] for store in stores])
        self.assertEqual(events.count(('open', report6.CRM_STORE_CODES['HNS'])), 1)
        self.assertEqual(sum(row['state'] == 'failed' for row in rows), 1)
        self.assertEqual(sum(row['state'] == 'completed' for row in rows), 13)


if __name__ == '__main__':
    unittest.main()
