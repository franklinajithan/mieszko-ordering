-- Apply after the reconciliation migration, with a fresh database backup.
BEGIN;
CREATE TABLE IF NOT EXISTS crm_partial_publications (
 store_id integer NOT NULL REFERENCES stores(id),
 source_type varchar(32) NOT NULL CHECK(source_type IN ('normal_sales','rtc','wastage')),
 report_date date NOT NULL,
 run_id bigint NOT NULL REFERENCES data_import_runs(id),
 data_sha256 text NOT NULL,
 published_row_count integer NOT NULL CHECK(published_row_count>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_id,source_type,report_date)
);
CREATE INDEX IF NOT EXISTS crm_partial_publications_run_idx ON crm_partial_publications(run_id);
COMMIT;
