import sys
import unittest
from pathlib import Path
from decimal import Decimal
from datetime import date
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import prepare_rows, FEEDS

class ValidationTests(unittest.TestCase):
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
