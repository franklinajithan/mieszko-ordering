-- Prepared only. Never run automatically against the office database.
BEGIN;
ALTER TABLE supplier_prices ADD COLUMN IF NOT EXISTS valid_until date;
CREATE INDEX IF NOT EXISTS supplier_prices_effective_lookup_idx ON supplier_prices(supplier_product_id,effective_date DESC,imported_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS data_import_runs_fingerprint_idx ON data_import_runs(store_id,source_type,source_start_date,source_end_date,((details->>'data_sha256'))) WHERE status='success';
COMMIT;
