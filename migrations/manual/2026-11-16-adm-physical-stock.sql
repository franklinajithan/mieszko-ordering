ALTER TABLE adm_orders
  ADD COLUMN IF NOT EXISTS physical_stock jsonb NOT NULL DEFAULT '{}'::jsonb;
