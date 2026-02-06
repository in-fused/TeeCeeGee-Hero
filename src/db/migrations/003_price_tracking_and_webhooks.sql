-- Migration 003: Price tracking, webhook subscriptions, and stock level management
-- Adds infrastructure for real-time inventory data from Pokemon TCG API and One Piece TCG API

-- Price history for tracking market price changes over time
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  source TEXT NOT NULL,
  observed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history (product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_observed ON price_history (observed_at DESC);

-- Add market_price column to products for latest known price
ALTER TABLE products ADD COLUMN IF NOT EXISTS market_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMP;

-- Webhook subscriptions for push notifications
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_triggered_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_active ON webhook_subscriptions (is_active);

-- Webhook delivery log for retry tracking
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  response_status INTEGER,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_del_sub ON webhook_deliveries (subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_del_status ON webhook_deliveries (status);

-- Stock levels with reorder point tracking
CREATE TABLE IF NOT EXISTS stock_levels (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 5,
  max_stock INTEGER NOT NULL DEFAULT 100,
  last_counted TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_levels_store ON stock_levels (store_id);
CREATE INDEX IF NOT EXISTS idx_stock_levels_product ON stock_levels (product_id);

-- Receiving events for processing incoming shipments
CREATE TABLE IF NOT EXISTS receiving_events (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER REFERENCES shipments(id) ON DELETE SET NULL,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  received_by TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  received_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receiving_store ON receiving_events (store_id);
CREATE INDEX IF NOT EXISTS idx_receiving_shipment ON receiving_events (shipment_id);

-- Receiving event line items
CREATE TABLE IF NOT EXISTS receiving_items (
  id SERIAL PRIMARY KEY,
  receiving_event_id INTEGER NOT NULL REFERENCES receiving_events(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  quantity_received INTEGER NOT NULL,
  quantity_expected INTEGER,
  condition TEXT NOT NULL DEFAULT 'sealed',
  unit_cost NUMERIC(10,2),
  discrepancies TEXT
);

CREATE INDEX IF NOT EXISTS idx_receiving_items_event ON receiving_items (receiving_event_id);
