-- Try to enable PostGIS; if unavailable, fall back to lat/lng with Haversine
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PostGIS not available — using Haversine fallback';
END
$$;

-- Store type classification per PRD
DO $$ BEGIN CREATE TYPE store_type AS ENUM ('big_box', 'lgs', 'vending', 'online', 'unknown'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Product type classification
DO $$ BEGIN CREATE TYPE product_type AS ENUM ('etb', 'booster_box', 'booster_pack', 'blister', 'collection_box', 'tin', 'bundle', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Game identifier
DO $$ BEGIN CREATE TYPE game_type AS ENUM ('pokemon', 'one_piece'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Language variants
DO $$ BEGIN CREATE TYPE language_type AS ENUM ('ENG', 'JPN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ZIP code centroids from US Census Bureau
CREATE TABLE IF NOT EXISTS zip_centroids (
  zip VARCHAR(5) PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  state VARCHAR(2),
  source TEXT NOT NULL DEFAULT 'US_CENSUS',
  retrieved_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add geography column only if PostGIS is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    BEGIN
      ALTER TABLE zip_centroids ADD COLUMN location GEOGRAPHY(POINT, 4326);
      CREATE INDEX idx_zip_centroids_location ON zip_centroids USING GIST(location);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
  END IF;
END
$$;

-- Retail store locations
CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  store_type store_type NOT NULL DEFAULT 'unknown',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  address TEXT,
  city TEXT,
  state VARCHAR(2),
  zip VARCHAR(5),
  osm_id BIGINT UNIQUE,
  source TEXT NOT NULL,
  retrieved_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    BEGIN
      ALTER TABLE stores ADD COLUMN location GEOGRAPHY(POINT, 4326);
      CREATE INDEX idx_stores_location ON stores USING GIST(location);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_stores_type ON stores (store_type);
CREATE INDEX IF NOT EXISTS idx_stores_state ON stores (state);
CREATE INDEX IF NOT EXISTS idx_stores_lat_lon ON stores (latitude, longitude);

-- Product catalog (TCG sealed products)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  tcgplayer_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  category TEXT NOT NULL,
  set_name TEXT,
  game game_type NOT NULL,
  product_type product_type NOT NULL DEFAULT 'other',
  language language_type NOT NULL DEFAULT 'ENG',
  msrp NUMERIC(10,2),
  source TEXT NOT NULL,
  retrieved_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_game ON products (game);
CREATE INDEX IF NOT EXISTS idx_products_type ON products (product_type);
CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin(to_tsvector('english', normalized_name));

-- SKU normalization table
CREATE TABLE IF NOT EXISTS skus (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT UNIQUE NOT NULL,
  retailer TEXT NOT NULL,
  variant_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skus_product ON skus (product_id);
CREATE INDEX IF NOT EXISTS idx_skus_retailer ON skus (retailer);

-- Public availability signals
CREATE TABLE IF NOT EXISTS availability_signals (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL,
  raw_data JSONB,
  observed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_product ON availability_signals (product_id);
CREATE INDEX IF NOT EXISTS idx_signals_store ON availability_signals (store_id);
CREATE INDEX IF NOT EXISTS idx_signals_observed ON availability_signals (observed_at DESC);

-- Shipment tracking (USPS/UPS/FedEx)
CREATE TABLE IF NOT EXISTS shipments (
  id SERIAL PRIMARY KEY,
  carrier TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  origin_zip VARCHAR(5),
  destination_zip VARCHAR(5),
  destination_store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  eta TIMESTAMP,
  last_event TEXT,
  last_event_at TIMESTAMP,
  source TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(carrier, tracking_number)
);

CREATE INDEX IF NOT EXISTS idx_shipments_store ON shipments (destination_store_id);
CREATE INDEX IF NOT EXISTS idx_shipments_eta ON shipments (eta);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments (status);

-- Restock history for pattern detection
CREATE TABLE IF NOT EXISTS restock_events (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_restock_store ON restock_events (store_id);
CREATE INDEX IF NOT EXISTS idx_restock_detected ON restock_events (detected_at DESC);

-- Connector health tracking
CREATE TABLE IF NOT EXISTS connector_health (
  id SERIAL PRIMARY KEY,
  connector_name TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_success_at TIMESTAMP,
  last_failure_at TIMESTAMP,
  last_error TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
