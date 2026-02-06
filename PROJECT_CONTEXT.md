# PackFinder Project Context

**Last Updated:** 2026-02-06
**Repository:** https://github.com/in-fused/TeeCeeGee-Hero
**Branch:** `claude/deploy-to-render-2RLXa`

---

## What This Is

TCG (Trading Card Game) inventory tracker for Pokemon and One Piece sealed products. The app helps users:

1. Find retail stores near a ZIP code that sell TCG products
2. Search product catalog (ETBs, booster boxes, tins, etc.)
3. Track product availability via crowdsourced sightings
4. Get marketplace links (TCGplayer, eBay) for online purchase

---

## Live Deployment

- **API:** https://packfinder-api.onrender.com
- **Frontend:** https://packfinder-web.onrender.com
- **Hosting:** Render (free tier)
- **Admin Secret:** `dd336adc5d69eacd10c0d534fbc161548be88db1e1da6d96`

---

## Tech Stack

### Backend (Node.js/Express)

- **Runtime:** Node.js 20+
- **Framework:** Express with helmet, CORS, rate limiting
- **Database:** PostgreSQL with PostGIS (auto-detects at runtime)
- **Validation:** Zod schemas
- **Logging:** Pino
- **Build:** TypeScript → dist/

### Frontend (React SPA)

- **Framework:** React 19 + Vite 7
- **Styling:** Tailwind CSS v4
- **Animations:** Framer Motion
- **Maps:** React-Leaflet + Leaflet
- **Routing:** React Router DOM

---

## Directory Structure

```
TeeCeeGee-Hero/
├── src/                          # Backend source
│   ├── server.ts                 # Express app + all API routes
│   ├── lib/
│   │   ├── db.ts                 # PostgreSQL pool + PostGIS detection
│   │   ├── env.ts                # Zod environment validation
│   │   └── logger.ts             # Pino logger
│   ├── routes/
│   │   └── admin.ts              # Admin ingest endpoints
│   ├── ingest/                   # Shared ingest modules
│   │   ├── helpers.ts            # Product classification helpers
│   │   ├── zip.ts                # ZIP code centroid ingest
│   │   ├── stores.ts             # Store location ingest
│   │   └── tcgcsv.ts             # Product catalog ingest
│   └── db/
│       └── migrations/           # SQL migration files
├── web/                          # Frontend source
│   ├── src/
│   │   ├── App.tsx               # Router setup
│   │   ├── pages/
│   │   │   ├── Home.tsx          # Landing page
│   │   │   ├── Search.tsx        # Product search
│   │   │   └── MapView.tsx       # Store finder map
│   │   ├── components/
│   │   │   ├── ProductCard.tsx   # Product display + marketplace links
│   │   │   ├── StoreCard.tsx     # Store display
│   │   │   └── ...
│   │   └── lib/
│   │       └── api.ts            # API client functions
│   └── dist/                     # Built static files
├── packages/                     # Connectors (legacy, now in src/ingest/)
│   ├── connectors/tcgcsv/
│   └── geo/
├── tests/                        # Vitest test suites
├── docs/
│   └── HOSTING_AND_DATA_STRATEGY.md
├── render.yaml                   # Render deployment blueprint
└── CLAUDE.md                     # Project instructions
```

---

## Database Schema

### Core Tables

```sql
-- ZIP code centroids (33,791 records)
CREATE TABLE zip_centroids (
  zip VARCHAR(5) PRIMARY KEY,
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  city VARCHAR(100),
  state VARCHAR(2)
);

-- Retail stores (220+ near LA)
CREATE TABLE stores (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  store_type VARCHAR(50),           -- 'big_box', 'lgs', 'vending'
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  address VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(2),                 -- Only 2-char codes accepted
  zip VARCHAR(10),
  source VARCHAR(50),
  osm_id BIGINT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product catalog (3,337 sealed products)
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  tcgplayer_id VARCHAR(50) UNIQUE,
  name VARCHAR(500) NOT NULL,
  normalized_name VARCHAR(500),
  category VARCHAR(100),
  set_name VARCHAR(255),
  game VARCHAR(50),                 -- 'pokemon', 'one_piece'
  product_type VARCHAR(50),         -- 'etb', 'booster_box', etc.
  language VARCHAR(10) DEFAULT 'en',
  source VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Availability signals (crowdsourced sightings)
CREATE TABLE availability_signals (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  store_id INTEGER REFERENCES stores(id),
  signal_type VARCHAR(50),          -- 'in_stock', 'out_of_stock', 'user_sighting'
  confidence DECIMAL(3,2),          -- 0.00 to 1.00
  source VARCHAR(100),
  notes TEXT,
  observed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Connector health tracking
CREATE TABLE connector_health (
  id SERIAL PRIMARY KEY,
  connector_name VARCHAR(100) NOT NULL,
  status VARCHAR(20),               -- 'healthy', 'degraded', 'failed'
  last_run TIMESTAMPTZ,
  records_processed INTEGER,
  error_message TEXT
);
```

---

## API Endpoints

### Public Endpoints

| Method | Path                                               | Description                           |
| ------ | -------------------------------------------------- | ------------------------------------- |
| GET    | `/health`                                          | Database connectivity check           |
| GET    | `/connectors/health`                               | Connector status                      |
| GET    | `/search?zip=90210&radius=15&store_type=big_box`   | Find stores near ZIP                  |
| GET    | `/products/search?game=pokemon&type=etb&q=scarlet` | Search products                       |
| GET    | `/products/:id`                                    | Single product with marketplace links |
| GET    | `/products/:id/signals`                            | Availability signals for product      |
| GET    | `/products/:id/stores`                             | Stores where product was sighted      |
| GET    | `/stores/:id/products`                             | Products sighted at store             |
| POST   | `/signals`                                         | Submit availability signal            |

### Admin Endpoints (requires Bearer token)

| Method | Path                   | Description                      |
| ------ | ---------------------- | -------------------------------- |
| POST   | `/admin/ingest/zip`    | Ingest ZIP centroids from Census |
| POST   | `/admin/ingest/stores` | Ingest stores from OpenStreetMap |
| POST   | `/admin/ingest/tcgcsv` | Ingest products from TCGCSV      |
| POST   | `/admin/ingest/all`    | Run all ingests sequentially     |

**Admin Authentication:**

```bash
curl -X POST https://packfinder-api.onrender.com/admin/ingest/all \
  -H "Authorization: Bearer dd336adc5d69eacd10c0d534fbc161548be88db1e1da6d96"
```

---

## Data Sources

### Current (Implemented)

1. **US Census Bureau** - ZIP code centroids
   - URL: `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip`
   - 33,791 ZIP codes with lat/lng

2. **OpenStreetMap Overpass API** - Store locations
   - Queries for Target, Walmart, GameStop, etc.
   - Returns name, location, address, OSM ID

3. **TCGCSV API** - Product catalog
   - Categories: Pokemon (3), One Piece (68)
   - Iterates through groups to get products
   - Filters to sealed products only

### Planned (Not Yet Implemented)

1. **TCGplayer API** - Real-time pricing (requires affiliate approval)
2. **eBay Browse API** - Listing prices and availability
3. **PokemonPriceTracker API** - Historical price data
4. **Crowdsourced signals** - User-reported sightings

---

## Frontend Features

### Home Page (`/`)

- Hero section with animated gradient
- Quick links to Search and Map
- Feature highlights

### Product Search (`/search`)

- Text search with debouncing
- Filter by game (Pokemon, One Piece)
- Filter by type (ETB, Booster Box, etc.)
- Expandable product cards with marketplace links
- Pagination (48 products per page)

### Store Map (`/map`)

- Enter ZIP code to find nearby stores
- Radius selector (5/15/20 miles)
- Store type filter (Big Box, Game Stores, Vending)
- Interactive Leaflet map with custom markers
- Click store to see:
  - Address and distance
  - Google Maps directions link
  - Products sighted at this store (with confidence %)
  - TCGplayer and eBay links for each product

---

## Key Implementation Details

### Product Classification (`src/ingest/helpers.ts`)

```typescript
// Detect product type from name
export function detectProductType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('elite trainer box') || lower.includes('etb')) return 'etb';
  if (lower.includes('booster box')) return 'booster_box';
  // ... etc
}

// Check if product is sealed (not singles)
export function isSealedProduct(name: string): boolean {
  const lower = name.toLowerCase();
  const sealedKeywords = ['box', 'pack', 'tin', 'bundle', 'collection', 'etb', 'blister'];
  return sealedKeywords.some((kw) => lower.includes(kw));
}
```

### Distance Calculation (`src/server.ts`)

```typescript
// PostGIS mode (if extension available)
ST_Distance(
  ST_MakePoint(s.longitude, s.latitude)::geography,
  ST_MakePoint($2, $1)::geography
) / 1609.34 AS distance_miles

// Haversine fallback (pure SQL)
3959 * acos(
  cos(radians($1)) * cos(radians(latitude)) *
  cos(radians(longitude) - radians($2)) +
  sin(radians($1)) * sin(radians(latitude))
) AS distance_miles
```

### Marketplace Links (`src/server.ts`)

```typescript
function buildMarketplaceLinks(product: { tcgplayer_id: string; name: string }) {
  return {
    tcgplayer: `https://www.tcgplayer.com/product/${product.tcgplayer_id}`,
    ebay_search: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(product.name)}&_sacat=0`,
  };
}
```

---

## Test Coverage

**74 tests passing** across 4 test files:

- `tests/routes.test.ts` (28 tests) - API endpoint validation
- `tests/schema.test.ts` (12 tests) - Database schema validation
- `tests/env.test.ts` (5 tests) - Environment variable validation
- `tests/ingest-logic.test.ts` (29 tests) - Product classification, sealed detection

Run tests:

```bash
npm test
```

---

## Current Data State

- **ZIP codes:** 33,791
- **Stores:** 220+ near Los Angeles
- **Products:** 3,337 sealed (299 Pokemon ETBs, 204 One Piece)
- **Connectors:** All 3 healthy

---

## Known Issues & Limitations

1. **No real-time inventory** - Only crowdsourced signals, no direct store API access
2. **TCGplayer affiliate required** - Real pricing needs API approval
3. **Free tier hosting** - May expire, see `docs/HOSTING_AND_DATA_STRATEGY.md` for backup options
4. **State field overflow** - OSM sometimes returns full state names; now filters to 2-char only

---

## Next Steps (Milestones)

### M3: Public Signal Engine

- eBay Browse API integration
- TCGplayer pricing (if approved)
- Restock scoring algorithm

### M4: Shipment Tracking

- USPS/UPS/FedEx tracking connectors
- ETA prediction model

### M5: Alerts & UX

- User notifications (email/push)
- User preferences storage
- Enhanced rate limiting

---

## Environment Variables

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
PORT=3000
NODE_ENV=production
ADMIN_SECRET=dd336adc5d69eacd10c0d534fbc161548be88db1e1da6d96
```

---

## Deployment Commands

### Build & Test

```bash
npm run build          # TypeScript compile
npm test               # Run tests
```

### Local Development

```bash
npm run dev            # Start with nodemon
cd web && npm run dev  # Start frontend dev server
```

### Trigger Data Ingest (Production)

```bash
# Windows PowerShell
Invoke-WebRequest -Uri "https://packfinder-api.onrender.com/admin/ingest/all" `
  -Method POST `
  -Headers @{ "Authorization" = "Bearer dd336adc5d69eacd10c0d534fbc161548be88db1e1da6d96" }

# Unix/Mac
curl -X POST https://packfinder-api.onrender.com/admin/ingest/all \
  -H "Authorization: Bearer dd336adc5d69eacd10c0d534fbc161548be88db1e1da6d96"
```

---

## Related Branch

There is additional code for inventory management at:

- **Branch:** `kimi-api`
- **URL:** https://github.com/in-fused/TeeCeeGee-Hero/tree/kimi-api

This branch contains scraping code and API sources for inventory/delivery tracking that should be reviewed and potentially integrated.
