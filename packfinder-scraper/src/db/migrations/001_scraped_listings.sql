-- ============================================================================
-- Scraped Listings & Inventory Tracking Tables
-- ============================================================================

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Scraped Listings Table
-- Stores all scraped product listings from retailers
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraped_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id TEXT NOT NULL,
  retailer TEXT NOT NULL,
  product_url TEXT NOT NULL,
  
  -- Product info
  name TEXT NOT NULL,
  game game_type NOT NULL,
  product_type product_type NOT NULL DEFAULT 'other',
  set_name TEXT,
  set_code TEXT,
  card_number TEXT,
  rarity TEXT,
  condition TEXT NOT NULL DEFAULT 'sealed',
  language TEXT DEFAULT 'ENG',
  
  -- Pricing
  price DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  msrp DECIMAL(10, 2),
  discount DECIMAL(5, 2),
  
  -- Availability
  status TEXT NOT NULL DEFAULT 'out_of_stock',
  quantity INTEGER,
  
  -- Media
  image_url TEXT,
  
  -- Metadata
  scraped_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  raw_data JSONB,
  
  -- Unique constraint per retailer + external ID
  CONSTRAINT unique_retailer_external_id UNIQUE (retailer, external_id)
);

-- Indexes for scraped_listings
CREATE INDEX IF NOT EXISTS idx_listings_retailer ON scraped_listings (retailer);
CREATE INDEX IF NOT EXISTS idx_listings_game ON scraped_listings (game);
CREATE INDEX IF NOT EXISTS idx_listings_product_type ON scraped_listings (product_type);
CREATE INDEX IF NOT EXISTS idx_listings_set_name ON scraped_listings (set_name);
CREATE INDEX IF NOT EXISTS idx_listings_status ON scraped_listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_price ON scraped_listings (price);
CREATE INDEX IF NOT EXISTS idx_listings_scraped_at ON scraped_listings (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_active ON scraped_listings (is_active) WHERE is_active = TRUE;

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_listings_name_search ON scraped_listings 
  USING gin(to_tsvector('english', name || ' ' || COALESCE(set_name, '')));

-- ============================================================================
-- Inventory Snapshots Table
-- Tracks inventory levels over time
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

-- Indexes for inventory_snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_listing_id ON inventory_snapshots (listing_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_snapshot_at ON inventory_snapshots (snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_retailer ON inventory_snapshots (retailer);

-- ============================================================================
-- Inventory Changes Table
-- Tracks significant changes (price drops, stock changes, etc.)
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

-- Indexes for inventory_changes
CREATE INDEX IF NOT EXISTS idx_changes_listing_id ON inventory_changes (listing_id);
CREATE INDEX IF NOT EXISTS idx_changes_type ON inventory_changes (change_type);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at ON inventory_changes (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_notified ON inventory_changes (notified) WHERE notified = FALSE;

-- ============================================================================
-- Price History Table
-- Time-series data for price tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID NOT NULL REFERENCES scraped_listings(id) ON DELETE CASCADE,
  retailer TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for price_history
CREATE INDEX IF NOT EXISTS idx_price_listing_id ON price_history (listing_id);
CREATE INDEX IF NOT EXISTS idx_price_recorded_at ON price_history (recorded_at DESC);

-- Partition price_history by month for better performance
-- (Run this after table creation if needed for large datasets)
-- CREATE TABLE price_history_y2024m01 PARTITION OF price_history
--   FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- ============================================================================
-- Price Alerts Table
-- User-configured price alerts
-- ============================================================================

CREATE TABLE IF NOT EXISTS price_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES scraped_listings(id) ON DELETE CASCADE,
  -- Can also alert on product pattern (name + set)
  product_name TEXT,
  set_name TEXT,
  condition TEXT,
  
  alert_type TEXT NOT NULL,
  threshold DECIMAL(10, 2) NOT NULL,
  triggered BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by TEXT,
  
  -- Notification settings
  notify_email TEXT,
  notify_webhook TEXT
);

-- Indexes for price_alerts
CREATE INDEX IF NOT EXISTS idx_alerts_listing_id ON price_alerts (listing_id);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON price_alerts (triggered) WHERE triggered = FALSE;

-- ============================================================================
-- Replenishment Needs Table
-- Auto-generated replenishment recommendations
-- ============================================================================

CREATE TABLE IF NOT EXISTS replenishment_needs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name TEXT NOT NULL,
  game game_type NOT NULL,
  set_name TEXT,
  
  -- Current state
  current_stock INTEGER NOT NULL DEFAULT 0,
  desired_stock INTEGER NOT NULL,
  shortage INTEGER NOT NULL,
  
  -- Best option
  best_price DECIMAL(10, 2),
  best_retailer TEXT,
  best_listing_id UUID REFERENCES scraped_listings(id),
  
  -- Priority
  priority TEXT NOT NULL DEFAULT 'medium',
  reason TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMP,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for replenishment_needs
CREATE INDEX IF NOT EXISTS idx_replenishment_status ON replenishment_needs (status);
CREATE INDEX IF NOT EXISTS idx_replenishment_priority ON replenishment_needs (priority);
CREATE INDEX IF NOT EXISTS idx_replenishment_game ON replenishment_needs (game);

-- ============================================================================
-- Purchase Orders Table
-- Track orders placed to replenish inventory
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT NOT NULL DEFAULT 'draft',
  retailer TEXT NOT NULL,
  
  -- Financials
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax DECIMAL(10, 2) NOT NULL DEFAULT 0,
  shipping DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  
  -- Tracking
  order_number TEXT,
  tracking_number TEXT,
  
  -- Dates
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ordered_at TIMESTAMP,
  expected_delivery TIMESTAMP,
  received_at TIMESTAMP,
  
  -- Metadata
  notes TEXT,
  created_by TEXT
);

-- Indexes for purchase_orders
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_po_retailer ON purchase_orders (retailer);

-- ============================================================================
-- Purchase Order Items Table
-- Individual items in a purchase order
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES scraped_listings(id),
  
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  
  -- Link to received inventory
  received_quantity INTEGER DEFAULT 0
);

-- Indexes for purchase_order_items
CREATE INDEX IF NOT EXISTS idx_poi_order_id ON purchase_order_items (order_id);

-- ============================================================================
-- Scraping Jobs Table
-- Track scraping job execution
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retailer TEXT,
  game game_type,
  
  -- Progress
  total_urls INTEGER DEFAULT 0,
  processed_urls INTEGER DEFAULT 0,
  successful_scrapes INTEGER DEFAULT 0,
  failed_scrapes INTEGER DEFAULT 0,
  
  -- Results
  new_listings INTEGER DEFAULT 0,
  updated_listings INTEGER DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  -- Error log
  errors JSONB DEFAULT '[]'::jsonb,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for scraping_jobs
CREATE INDEX IF NOT EXISTS idx_jobs_status ON scraping_jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_retailer ON scraping_jobs (retailer);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON scraping_jobs (created_at DESC);

-- ============================================================================
-- Retailer Config Table
-- Configuration for each retailer scraper
-- ============================================================================

CREATE TABLE IF NOT EXISTS retailer_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_ms INTEGER NOT NULL DEFAULT 1500,
  
  -- Scraping config
  selectors JSONB NOT NULL DEFAULT '{}'::jsonb,
  api_config JSONB,
  search_endpoints JSONB DEFAULT '[]'::jsonb,
  
  -- Stats
  last_scraped_at TIMESTAMP,
  total_listings INTEGER DEFAULT 0,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
DROP TRIGGER IF EXISTS update_scraped_listings_updated_at ON scraped_listings;
CREATE TRIGGER update_scraped_listings_updated_at
  BEFORE UPDATE ON scraped_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_replenishment_needs_updated_at ON replenishment_needs;
CREATE TRIGGER update_replenishment_needs_updated_at
  BEFORE UPDATE ON replenishment_needs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_retailer_configs_updated_at ON retailer_configs;
CREATE TRIGGER update_retailer_configs_updated_at
  BEFORE UPDATE ON retailer_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Function to detect and record inventory changes
-- ============================================================================

CREATE OR REPLACE FUNCTION record_inventory_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Price change
  IF OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO inventory_changes (listing_id, retailer, change_type, old_value, new_value)
    VALUES (NEW.id, NEW.retailer, 'price_change', 
            jsonb_build_object('price', OLD.price),
            jsonb_build_object('price', NEW.price));
  END IF;
  
  -- Stock/quantity change
  IF OLD.quantity IS DISTINCT FROM NEW.quantity THEN
    INSERT INTO inventory_changes (listing_id, retailer, change_type, old_value, new_value)
    VALUES (NEW.id, NEW.retailer, 'stock_change',
            jsonb_build_object('quantity', OLD.quantity),
            jsonb_build_object('quantity', NEW.quantity));
  END IF;
  
  -- Status change
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO inventory_changes (listing_id, retailer, change_type, old_value, new_value)
    VALUES (NEW.id, NEW.retailer, 'status_change',
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status));
  END IF;
  
  -- Record price history
  IF OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO price_history (listing_id, retailer, price, currency)
    VALUES (NEW.id, NEW.retailer, NEW.price, NEW.currency);
  END IF;
  
  -- Record inventory snapshot
  INSERT INTO inventory_snapshots (listing_id, retailer, quantity, status, price)
  VALUES (NEW.id, NEW.retailer, NEW.quantity, NEW.status, NEW.price);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply change detection trigger
DROP TRIGGER IF EXISTS detect_listing_changes ON scraped_listings;
CREATE TRIGGER detect_listing_changes
  AFTER UPDATE ON scraped_listings
  FOR EACH ROW EXECUTE FUNCTION record_inventory_change();

-- Also record on insert
DROP TRIGGER IF EXISTS record_new_listing ON scraped_listings;
CREATE TRIGGER record_new_listing
  AFTER INSERT ON scraped_listings
  FOR EACH ROW EXECUTE FUNCTION record_inventory_change();
