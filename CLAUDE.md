# PackFinder API — Project Context

## What this is
TCG inventory tracker for Pokemon + One Piece sealed products. Finds stores near a ZIP code, tracks product availability, scrapes marketplace listings, and will eventually track shipments + send restock alerts.

## Current state
- Active branch: `claude/debug-packfinder-deploy-4Tjuv` (Render deploys from this)
- Build: clean (TypeScript compiles, 135/135 tests pass)
- Deployed on Render (free tier): packfinder-db, packfinder-api, packfinder-web
- Scraper module integrated with TCGPlayer + eBay working
- Playwright MCP server configured for future browser automation

## Architecture
- Express API server (`src/server.ts`) with connection pooling, helmet, CORS, rate limiting
- React 19 + Vite + Tailwind CSS frontend (`web/`)
- PostgreSQL with PostGIS/Haversine dual-mode (auto-detects at runtime)
- Versioned migrations (`src/db/migrations/`, 001-004)
- Shared libs: `src/lib/env.ts` (zod validation), `src/lib/db.ts` (pool + PostGIS detection), `src/lib/logger.ts` (pino)
- Connectors: `packages/connectors/tcgcsv/`, `packages/geo/zip/`, `packages/geo/stores/`
- Scraper module: `src/scraper/` (client, fingerprint, auth), `src/retailers/` (TCGPlayer, eBay, generics)

## Key endpoints
- `GET /health` — DB connectivity check
- `GET /connectors/health` — connector status
- `GET /search?zip=90210&radius=15&store_type=big_box` — store search (also returns TCG products with marketplace links)
- `GET /products/search?game=pokemon&type=etb&q=scarlet` — product search with pagination
- `GET /products/:id/signals` — availability signals
- `GET /stores/:id/shipments` — incoming shipments
- `GET /admin/scraper/search?q=pokemon+etb` — live scraper search across retailers (requires ADMIN_SECRET)
- `GET /admin/scraper/status` — scraper status + DB stats
- `GET /admin/scraper/listings` — stored scraped listings
- `POST /admin/scraper/product` — scrape a single product URL
- `POST /admin/scraper/set` — background set scrape job

## Scraper data sources
| Retailer | Status | Method |
|----------|--------|--------|
| TCGplayer | Working | POST to `mp-search-api.tcgplayer.com/v1/search/request` (no auth) |
| eBay | Working (may rate-limit) | HTML parsing + JSON-LD fallback |
| Amazon | Needs Playwright | JS-rendered, `needsBrowser: true` |
| Walmart | Needs Playwright | JS-rendered, `needsBrowser: true` |
| Target | Needs Playwright | JS-rendered, `needsBrowser: true` |
| GameStop | Needs Playwright | JS-rendered, `needsBrowser: true` |
| Best Buy | Needs Playwright | JS-rendered, `needsBrowser: true` |

## Deployment (Render)
- `render.yaml` blueprint — packfinder-db (PostgreSQL 16), packfinder-api, packfinder-web
- Render currently pointed at `claude/debug-packfinder-deploy-4Tjuv` branch
- After deploy: run `npm run ingest:zip`, `npm run ingest:stores`, `npm run ingest:tcgcsv` from Render Shell
- ADMIN_SECRET env var required for scraper routes
- VITE_ADMIN_SECRET env var required for frontend scraper dashboard
- VITE_API_URL should point to the packfinder-api URL

## Branch situation
- `packfinder-api`: original baseline (behind)
- `claude/debug-packfinder-deploy-4Tjuv`: **most complete branch** — all features, Render deploys from here
- `claude/store-inventory-realtime-z7P5t`: has store inventory work but missing scraper commit
- To consolidate: merge `claude/debug-packfinder-deploy-4Tjuv` into `packfinder-api` via GitHub PR

## Milestones remaining
- M3: Public Signal Engine — eBay API, TCGPlayer listings, restock scoring (partially done via scraper)
- M3.5: Browser automation — activate Amazon/Walmart/Target/GameStop/BestBuy scrapers via Playwright
- M4: Shipment Tracking — USPS/UPS/FedEx connectors, ETA model
- M5: Alerts & UX — notifications, user preferences, rate limiting

## Known issues / next steps
- Store search shows stores + generic product list, but no per-store inventory (needs availability_signals data or retail APIs)
- Products table needs `npm run ingest:tcgcsv` to populate — without it, store search products section is empty
- 5 generic scrapers return empty (need Playwright browser automation)
- Playwright MCP server registered but only available in new sessions
- Search results auto-save to `scraped_listings` table (populates Stored Listings panel)

## Guardrails (hard rules)
- No mock data, no synthetic records, no test fixtures in production paths
- No inferred data without explicit confidence + source
- If a data source fails: endpoint still responds, status is explicit
- Testing uses real recorded API responses, schema validation, connector health checks
