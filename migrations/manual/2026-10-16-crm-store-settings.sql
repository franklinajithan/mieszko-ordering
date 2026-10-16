-- Prepared upgrade. Back up and apply explicitly on the office PostgreSQL server.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
CREATE TABLE IF NOT EXISTS store_crm_settings (
  store_id integer PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  crm_url text NOT NULL,
  nightly_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_crm_settings_url CHECK (crm_url ~ '^https?://' AND length(crm_url) <= 2048)
);
COMMIT;
-- No URLs, credentials or schedules are seeded or activated by this migration.
