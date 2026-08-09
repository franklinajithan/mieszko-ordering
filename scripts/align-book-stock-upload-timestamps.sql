-- Book stock uploads keep a timestamp; same-day re-uploads are retained.
-- Ordering / calculation always uses the latest imported_at for the store (or date).

ALTER TABLE book_stock
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE book_stock
SET imported_at = coalesce(updated_at, created_at, now())
WHERE imported_at IS NULL;

ALTER TABLE book_stock
  ALTER COLUMN imported_at SET DEFAULT now(),
  ALTER COLUMN imported_at SET NOT NULL;

ALTER TABLE book_stock
  DROP CONSTRAINT IF EXISTS book_stock_store_product_date_unique;

ALTER TABLE book_stock
  DROP CONSTRAINT IF EXISTS book_stock_store_product_imported_at_unique;

ALTER TABLE book_stock
  ADD CONSTRAINT book_stock_store_product_imported_at_unique
  UNIQUE (store_product_id, imported_at);

CREATE INDEX IF NOT EXISTS book_stock_date_imported_at_idx
  ON book_stock (book_stock_date, imported_at);
