import sys
import unittest
import tempfile
import hashlib
from pathlib import Path
from unittest.mock import MagicMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import resolve_identifiers, retained_report

class RecoveryTests(unittest.TestCase):
    def test_barcode_normalization_is_conservative(self):
        rows = {(code, '2026-10-18'): 1 for code in ['00123456789012','123456789012.0','ABC-123','12345678901X']}
        matched, unknown = resolve_identifiers(rows,[('123456789012',11),('123',12)],'barcode')
        self.assertEqual(matched,{'00123456789012':11,'123456789012.0':11})
        self.assertEqual(unknown,['12345678901X','ABC-123'])
    def test_ambiguous_barcode_is_not_resolved_even_with_override(self):
        self.assertEqual(resolve_identifiers({('123456789012','day'):1},[('123456789012',11),('00123456789012',12)],'barcode',{'123456789012':11}),({},['123456789012']))
    def test_item_codes_never_use_barcode_padding_or_case_folding(self):
        self.assertEqual(resolve_identifiers({('0012','day'):1,('ABC','day'):1},[('12',11),('abc',12)],'store_product_code'),({},['0012','ABC']))
    def test_verified_alternative_only_applies_to_missing_identifier(self):
        self.assertEqual(resolve_identifiers({('missing','day'):1,('known','day'):1},[('known',11)],'store_product_code',{'missing':12,'known':13}),({'known':11,'missing':12},[]))
    def test_retained_file_requires_store_feed_dates_and_unchanged_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); path=root/'report.xls';path.write_bytes(b'fixture')
            conn=MagicMock()
            conn.execute.return_value.fetchone.side_effect=[('3',),(str(path),hashlib.sha256(b'fixture').hexdigest())]
            self.assertEqual(retained_report(conn,4,1,'wastage','2026-10-18','2026-10-18',root),path)
            conn.execute.return_value.fetchone.side_effect=[('3',),(str(path),'wrong')]
            with self.assertRaisesRegex(ValueError,'checksum'): retained_report(conn,4,1,'wastage','2026-10-18','2026-10-18',root)
            conn.execute.return_value.fetchone.side_effect=[('3',),('/etc/passwd',None)]
            with self.assertRaisesRegex(ValueError,'outside'): retained_report(conn,4,1,'wastage','2026-10-18','2026-10-18',root)

class RetryTests(unittest.TestCase):
    def run_failure(self, code, cancelled=False):
        import worker
        from unittest.mock import patch
        import subprocess
        import json
        conn=MagicMock()
        def execute(query, params=None):
            result=MagicMock()
            if 'SELECT code FROM stores' in query: result.fetchone.return_value=('HYS',)
            elif "reuse_file_of" in query: result.fetchone.return_value=(None,)
            elif 'SELECT status FROM data_import_runs' in query: result.fetchone.return_value=('failed' if cancelled else 'downloading',)
            return result
        conn.execute.side_effect=execute
        with tempfile.TemporaryDirectory() as folder:
            config={'download_directory':folder,'stores':{'4':{'code':'HYS','feeds':{'wastage':{'complete_store_report':True,'extension':'.csv','command':['fixture'],'mapping':{'code':'Code','quantity':'Qty'}}}}}}
            with patch.object(worker.subprocess,'run',return_value=subprocess.CompletedProcess([],1,stderr=json.dumps({'error_code':code}).encode())) as run, patch.object(worker.time,'sleep') as sleep:
                worker.process_job(conn,config,(1,4,'wastage','2026-10-18','2026-10-18'))
                return run.call_count,[call.args[0] for call in sleep.call_args_list]
    def test_transient_errors_have_three_attempts_and_bounded_backoff(self):
        self.assertEqual(self.run_failure('login_page'),(3,[5,10]))
    def test_invalid_crm_configuration_is_not_retried(self):
        self.assertEqual(self.run_failure('wastage_filters'),(1,[]))
    def test_operator_cancel_prevents_retry(self):
        self.assertEqual(self.run_failure('login_page',True),(1,[5]))
