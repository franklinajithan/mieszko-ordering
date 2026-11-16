BEGIN;

CREATE TABLE IF NOT EXISTS adm_shop_assortments (
  store_id integer PRIMARY KEY REFERENCES stores(id),
  items jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS adm_orders (
  store_id integer NOT NULL REFERENCES stores(id),
  delivery_date date NOT NULL,
  quantities jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, delivery_date)
);

CREATE TABLE IF NOT EXISTS adm_shop_catalogs (
  store_id integer PRIMARY KEY REFERENCES stores(id),
  items jsonb NOT NULL,
  previous_date date
);

COMMIT;
