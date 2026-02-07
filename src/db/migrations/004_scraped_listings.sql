-- Migration 004: Scraped listings, inventory tracking, and replenishment
-- Adds scraper infrastructure for multi-retailer price/stock monitoring

-- Extension for UUID generation (safe if already exists)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Scraped Listings — stores all scraped product listings from retailers
-- Uses TEXT for game/product_type to avoid altering existing enums
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraped_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id TEXT NOT NULL,
  retailer TEXT NOT NULL,
  product_url TEXT NOT NULL,
  name TEXT NOT NULL,
  game TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'other',
  set_name TEXT,
  set_code TEXT,
  card_number TEXT,
  rarity TEXT,
  condition TEXT NOT NULL DEFAULT 'sealed',
  language TEXT DEFAULT 'ENG',
  price DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  msrp DECIMAL(10, 2),
  discount DECIMAL(5, 2),
  status TEXT NOT NULL DEFAULT 'out_of_stock',
  quantity INTEGER,
  image_url TEXT,
  scraped_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  raw_data JSONB,
  CONSTRAINT unique_retailer_external_id UNIQUE (retailer, external_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_retailer ON scraped_listings (retailer);
CREATE INDEX IF NOT EXISTS idx_listings_game ON scraped_listings (game);
CREATE INDEX IF NOT EXISTS idx_listings_product_type ON scraped_listings (product_type);
CREATE INDEX IF NOT EXISTS idx_listings_set_name ON scraped_listings (set_name);
CREATE INDEX IF NOT EXISTS idx_listings_status ON scraped_listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_price ON scraped_listings (price);
CREATE INDEX IF NOT EXISTS idx_listings_scraped_at ON scraped_listings (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_active ON scraped_listings (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_listings_name_search ON scraped_listings
  USING gin(to_tsvector('english', name || ' ' || COALESCE(set_name, '')));

-- ============================================================================
-- Inventory Snapshots — tracks inventory levels over time
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID NOT NULL REFERENCES scraped_listings(id) ON DELETE CASCADE,
  retailer TEXT NOT NULL,
  quantity INTEGER,
  status TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_listing_id ON inventory_snapshots (listing_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_snapshot_at ON inventory_snapshots (snapshot_at DESC);

-- ============================================================================
-- Inventory Changes — tracks significant changes (price drops, stock changes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID NOT NULL REFERENCES scraped_listings(id) ON DELETE CASCADE,
  retailer TEXT NOT NULL,
  change_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notified BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_changes_listing_id ON inventory_changes (listing_id);
CREATE INDEX IF NOT EXISTS idx_changes_type ON inventory_changes (change_type);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at ON inventory_changes (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_notified ON inventory_changes (notified) WHERE notified = FALSE;

-- ============================================================================
-- Scraper Price History — separate from existing price_history for products
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraper_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID NOT NULL REFERENCES scraped_listings(id) ON DELETE CASCADE,
  retailer TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_price_listing ON scraper_price_history (listing_id);
CREATE INDEX IF NOT EXISTS idx_scraper_price_recorded ON scraper_price_history (recorded_at DESC);

-- ============================================================================
-- Replenishment Needs — auto-generated replenishment recommendations
-- ============================================================================

CREATE TABLE IF NOT EXISTS replenishment_needs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name TEXT NOT NULL,
  game TEXT NOT NULL,
  set_name TEXT,
  current_stock INTEGER NOT NULL DEFAULT 0,
  desired_stock INTEGER NOT NULL,
  shortage INTEGER NOT NULL,
  best_price DECIMAL(10, 2),
  best_retailer TEXT,
  best_listing_id UUID REFERENCES scraped_listings(id),
  priority TEXT NOT NULL DEFAULT 'medium',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replenishment_status ON replenishment_needs (status);
CREATE INDEX IF NOT EXISTS idx_replenishment_priority ON replenishment_needs (priority);

-- ============================================================================
-- Purchase Orders — track orders placed to replenish inventory
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT NOT NULL DEFAULT 'draft',
  retailer TEXT NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax DECIMAL(10, 2) NOT NULL DEFAULT 0,
  shipping DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  order_number TEXT,
  tracking_number TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ordered_at TIMESTAMP,
  expected_delivery TIMESTAMP,
  received_at TIMESTAMP,
  notes TEXT,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders (status);

-- ============================================================================
-- Purchase Order Items
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES scraped_listings(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  received_quantity INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_poi_order_id ON purchase_order_items (order_id);

-- ============================================================================
-- Scraping Jobs — track scraping job execution
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retailer TEXT,
  game TEXT,
  total_urls INTEGER DEFAULT 0,
  processed_urls INTEGER DEFAULT 0,
  successful_scrapes INTEGER DEFAULT 0,
  failed_scrapes INTEGER DEFAULT 0,
  new_listings INTEGER DEFAULT 0,
  updated_listings INTEGER DEFAULT 0,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  errors JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON scraping_jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON scraping_jobs (created_at DESC);

-- ============================================================================
-- Auth Sessions — stored authenticated sessions for retailer scraping
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraper_auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer TEXT NOT NULL UNIQUE,
  cookies JSONB NOT NULL DEFAULT '[]'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- ============================================================================
-- Triggers for updated_at and change detection
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_scraped_listings_updated_at ON scraped_listings;
CREATE TRIGGER update_scraped_listings_updated_at
  BEFORE UPDATE ON scraped_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_replenishment_needs_updated_at ON replenishment_needs;
CREATE TRIGGER update_replenishment_needs_updated_at
  BEFORE UPDATE ON replenishment_needs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Change detection trigger for scraped listings
CREATE OR REPLACE FUNCTION record_inventory_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Price change
    IF OLD.price IS DISTINCT FROM NEW.price THEN
      INSERT INTO inventory_changes (listing_id, retailer, change_type, old_value, new_value)
      VALUES (NEW.id, NEW.retailer, 'price_change',
              jsonb_build_object('price', OLD.price),
              jsonb_build_object('price', NEW.price));
      INSERT INTO scraper_price_history (listing_id, retailer, price, currency)
      VALUES (NEW.id, NEW.retailer, NEW.price, NEW.currency);
    END IF;

    -- Status change
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO inventory_changes (listing_id, retailer, change_type, old_value, new_value)
      VALUES (NEW.id, NEW.retailer, 'status_change',
              jsonb_build_object('status', OLD.status),
              jsonb_build_object('status', NEW.status));
    END IF;

    -- Quantity change
    IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
      INSERT INTO inventory_changes (listing_id, retailer, change_type, old_value, new_value)
      VALUES (NEW.id, NEW.retailer, 'stock_change',
              jsonb_build_object('quantity', OLD.quantity),
              jsonb_build_object('quantity', NEW.quantity));
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS detect_listing_changes ON scraped_listings;
CREATE TRIGGER detect_listing_changes
  AFTER UPDATE ON scraped_listings
  FOR EACH ROW EXECUTE FUNCTION record_inventory_change();
