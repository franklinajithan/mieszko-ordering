-- Review and apply only on the office PC. Preserves historical default behavior.
BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS include_book_stock boolean NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS include_future_deliveries boolean NOT NULL DEFAULT false;
COMMIT;
