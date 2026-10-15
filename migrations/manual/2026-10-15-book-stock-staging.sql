-- Prepare only; apply on the office PC after approval, before using chunked uploads.
BEGIN;
CREATE TABLE IF NOT EXISTS book_stock_import_stage (
  store_id integer NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL,
  store_product_id integer NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  book_stock_date date NOT NULL,
  quantity numeric(18,4) NOT NULL,
  expected_rows integer NOT NULL CHECK (expected_rows > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, imported_at, store_product_id)
);
CREATE INDEX IF NOT EXISTS book_stock_stage_created_idx ON book_stock_import_stage(created_at);
COMMIT;
-- Abandoned staging rows can be removed after review; they never affect live stock.
