from datetime import date
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

AUTOMATION = Path(__file__).resolve().parents[1]
with patch.object(sys, 'path', [str(AUTOMATION), *sys.path]):
    spec = importlib.util.spec_from_file_location('manual_wastage_pdf', AUTOMATION / 'manual-wastage-pdf.py')
    manual = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manual)


class ManualWastagePdfTests(unittest.TestCase):
    def test_exports_missing_pdfs_and_keeps_per_store_progress(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archive = root / 'downloads'
            folder = archive / '.manual-pdfs' / '2026-11-10'
            folder.mkdir(parents=True)
            (root / 'automation').mkdir()
            (root / 'automation/config.local.json').write_text(json.dumps({
                'store_settings_source': 'database',
                'download_directory': str(archive),
            }))
            connect = MagicMock()
            conn = connect.return_value.__enter__.return_value
            conn.execute.return_value.fetchall.return_value = [(1, 'Hayes'), (2, 'Watford'), (3, 'Hounslow')]
            status = {'state': 'running', 'stores': [], 'message': ''}
            args = SimpleNamespace(worker_directory=root, archive=archive, date=date(2026, 11, 10), skip=[1])
            exports = []

            def download(_url, code, feed, start, end, output, *, progress, pdf_only):
                self.assertTrue(pdf_only)
                self.assertEqual((feed, start, end), ('wastage', '2026-11-10', '2026-11-10'))
                progress('Downloading PDF')
                on_disk = json.loads((folder / 'status.json').read_text())
                self.assertTrue(any(store['step'] == 'Downloading PDF' for store in on_disk['stores']))
                exports.append(code)
                if code == '0602':
                    raise ValueError('private error details')
                output.write_bytes(b'%PDF-1.7\nfixture')

            settings = [{'crm_url': 'fixture', 'code': 'WTF'}, {'crm_url': 'fixture', 'code': 'HNS'}]
            with patch.dict(sys.modules, {'psycopg': SimpleNamespace(connect=connect)}), \
                 patch.dict(manual.os.environ, {'DATABASE_URL': 'fixture'}), \
                 patch.object(manual, 'runtime_environment', return_value={}), \
                 patch.object(manual, 'get_store_config', side_effect=settings), \
                 patch.object(manual, 'download', side_effect=download):
                manual.run(args, folder, status)

            self.assertEqual(exports, ['0602', '0365'])
            self.assertEqual([store['state'] for store in status['stores']], ['complete', 'failed', 'complete'])
            self.assertEqual(status['stores'][1]['step'], 'Downloading PDF (ValueError)')
            self.assertEqual(status['state'], 'failed')
            self.assertFalse((folder / '1').exists())
            self.assertEqual((folder / '3' / 'report.pdf').read_bytes(), b'%PDF-1.7\nfixture')
