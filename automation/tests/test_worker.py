import sys
import unittest
import tempfile
import json
from unittest.mock import patch, MagicMock
from pathlib import Path
from decimal import Decimal
from datetime import date
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import prepare_rows, FEEDS, crm_store_code, enabled_movement_sources
import worker

class ValidationTests(unittest.TestCase):
    def test_service_stop_finishes_current_job_and_leaves_the_next_queued(self):
        database = MagicMock()
        signals = {}
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'config.json'
            config.write_text(json.dumps({'stores':{}}))
            with patch.dict(sys.modules, {'psycopg': database}), \
                    patch.dict(worker.os.environ, {'DATABASE_URL':'fixture-only'}), \
                    patch('sys.argv', ['worker', '--config', str(config)]), \
                    patch.object(worker.signal, 'signal', side_effect=lambda number, handler: signals.update({number:handler})), \
                    patch.object(worker, 'claim', return_value=(1,1,'wastage','2026-10-14','2026-10-14')) as claim, \
                    patch.object(worker, 'process_job', side_effect=lambda *_: signals[worker.signal.SIGTERM](None,None)) as process:
                worker.main()
            self.assertEqual(process.call_count, 1)
            self.assertEqual(claim.call_count, 1)

    def test_office_application_codes_resolve_to_exact_crm_markers(self):
        for code, marker in {'HNS':'0365','PVL':'0766','EAS':'0650','HYS':'0665','GRV':'0566','WTF':'0602','STR':'0388'}.items():
            with self.subTest(code=code):
                self.assertEqual(crm_store_code(code), marker)
                self.assertEqual(crm_store_code(marker), marker)
        for unknown in ['MIT', 'SBH', '665', 'unknown', '']:
            with self.assertRaises(ValueError): crm_store_code(unknown)

    def test_only_verified_movement_feeds_can_be_claimed_or_scheduled(self):
        config = {'store_settings_source':'database','store_defaults':{'feeds':{
            'wastage':{'complete_store_report':True},'rtc':{'complete_store_report':False},
            'book_stock':{'complete_store_report':True}}}}
        self.assertEqual(enabled_movement_sources(config), ['wastage'])
        config['store_defaults']['feeds']['wastage']['complete_store_report'] = False
        self.assertEqual(enabled_movement_sources(config), [])

    mapping = {'code': 'Code', 'quantity': 'Qty', 'date': 'Date'}
    def prepare(self, rows, source='normal_sales', start='2026-10-14', end='2026-10-14'):
        return prepare_rows(rows, self.mapping, source, start, end)
    def test_empty_movement_requires_explicit_verification(self):
        self.assertEqual(prepare_rows([],self.mapping,'rtc','2026-10-14','2026-10-14',allow_empty=True), {})
        with self.assertRaises(ValueError): prepare_rows([],self.mapping,'book_stock','2026-10-14','2026-10-14',allow_empty=True)
    def test_feeds_are_distinct(self):
        self.assertEqual(len({value[0] for value in FEEDS.values()}), 4)
    def test_duplicate_lines_sum(self):
        self.assertEqual(self.prepare([{'Code':'0001','Qty':'2'}, {'Code':'0001','Qty':'3'}]), {('0001', date(2026,10,14)):Decimal(5)})
    def test_negative_stock_preserved(self):
        self.assertEqual(next(iter(self.prepare([{'Code':'1','Qty':'-2'}], 'book_stock').values())), Decimal(-2))
    def test_negative_normal_sales_preserved(self):
        self.assertEqual(next(iter(self.prepare([{'Code':'1','Qty':'-2'}]).values())), Decimal(-2))
    def test_invalid_reports_fail(self):
        for rows in ([], [{'Code':'','Qty':'1'}], [{'Code':'1','Qty':''}], [{'Code':'1','Qty':'NaN'}], [{'Code':'1','Qty':'Infinity'}], [{'Code':'1','Qty':'0.00001'}], [{'Code':'1','Qty':'2','Date':'2026-10-15'}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError): self.prepare(rows)
    def test_negative_losses_rejected(self):
        with self.assertRaises(ValueError): self.prepare([{'Code':'1','Qty':'-2'}], 'wastage')
    def test_period_totals_not_misrepresented_as_daily_sales(self):
        with self.assertRaises(ValueError): self.prepare([{'Code':'1','Qty':'2'}], end='2026-10-15')
    def test_unknown_source_rejected(self):
        with self.assertRaises(ValueError): self.prepare([{'Code':'1','Qty':'2'}], 'sales_and_rtc')

if __name__ == '__main__': unittest.main()
