-- Apply once to an existing PostgreSQL database before deploying date-aware queries.
-- Existing records remain undated and must be assigned a real expected date.
ALTER TABLE future_deliveries
  ADD COLUMN IF NOT EXISTS expected_delivery_date date;

CREATE INDEX IF NOT EXISTS future_deliveries_expected_date_idx
  ON future_deliveries (expected_delivery_date);
