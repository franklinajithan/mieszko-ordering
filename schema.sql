-- PostgreSQL schema for Mieszko Ordering MVP
-- Source of truth for Drizzle schema in src/db/schema.ts

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  price_tie_priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(500) NOT NULL,
  department VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  product_id UUID NOT NULL REFERENCES products(id),
  store_product_code VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, store_product_code)
);

CREATE TABLE product_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  barcode VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  supplier_code VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, supplier_code)
);

CREATE TABLE daily_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_product_id UUID NOT NULL REFERENCES store_products(id),
  sales_date DATE NOT NULL,
  sold_qty NUMERIC(18, 4) NOT NULL,
  rtc_qty NUMERIC(18, 4),
  promo_qty NUMERIC(18, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_product_id, sales_date)
);

CREATE TABLE supplier_price_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  effective_date DATE NOT NULL,
  file_name VARCHAR(500),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE supplier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES supplier_price_imports(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  supplier_product_id UUID REFERENCES supplier_products(id),
  supplier_code VARCHAR(100) NOT NULL,
  net_price NUMERIC(18, 4) NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  book_stock_date DATE NOT NULL,
  client_delivery_date DATE NOT NULL,
  department_filters TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_sales_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  period_key VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  UNIQUE (order_id, period_key)
);

CREATE TABLE order_price_suppliers (
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  PRIMARY KEY (order_id, supplier_id)
);

CREATE TABLE order_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  upload_type VARCHAR(50) NOT NULL,
  file_name VARCHAR(500) NOT NULL,
  mapping_type VARCHAR(50) NOT NULL,
  reference_column VARCHAR(255) NOT NULL,
  quantity_column VARCHAR(255) NOT NULL,
  supplier_id UUID REFERENCES suppliers(id),
  delivery_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_stock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  upload_id UUID REFERENCES order_uploads(id),
  event_type VARCHAR(50) NOT NULL,
  event_date DATE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_stock_event_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES order_stock_events(id) ON DELETE CASCADE,
  store_product_id UUID NOT NULL REFERENCES store_products(id),
  quantity NUMERIC(18, 4) NOT NULL
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  store_product_id UUID NOT NULL REFERENCES store_products(id),
  period_1_sales NUMERIC(18, 4) NOT NULL DEFAULT 0,
  period_2_sales NUMERIC(18, 4) NOT NULL DEFAULT 0,
  period_3_sales NUMERIC(18, 4) NOT NULL DEFAULT 0,
  previous_year_sales NUMERIC(18, 4) NOT NULL DEFAULT 0,
  highest_sold_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  book_stock_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  received_not_posted_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  future_delivery_total_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  forecast_sales_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  shortage_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  projected_final_stock_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  suggested_order_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  final_order_qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  price_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  cheapest_supplier_id UUID REFERENCES suppliers(id),
  cheapest_net_price NUMERIC(18, 4),
  estimated_line_cost NUMERIC(18, 4),
  calculation_breakdown JSONB,
  warning TEXT,
  UNIQUE (order_id, store_product_id)
);

CREATE TABLE order_item_supplier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  supplier_code VARCHAR(100),
  net_price NUMERIC(18, 4),
  price_validation_status VARCHAR(50) NOT NULL,
  is_cheapest BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  UNIQUE (order_item_id, supplier_id)
);

CREATE OR REPLACE VIEW current_supplier_prices AS
SELECT DISTINCT ON (sp.supplier_id, sp.supplier_product_id)
  sp.id,
  sp.supplier_id,
  sp.supplier_product_id,
  sp.supplier_code,
  sp.net_price,
  sp.effective_date,
  sp.created_at
FROM supplier_prices sp
WHERE sp.supplier_product_id IS NOT NULL
ORDER BY sp.supplier_id, sp.supplier_product_id, sp.effective_date DESC, sp.created_at DESC;
