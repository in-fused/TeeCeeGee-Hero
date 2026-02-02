# PackFinder API — Project Context

## What this is
TCG inventory tracker for Pokemon + One Piece sealed products. Finds stores near a ZIP code, tracks product availability, and will eventually track shipments + send restock alerts.

## Current state
- Branch: `claude/review-repo-structure-HyNi1`
- Build: clean (TypeScript compiles, 33/33 tests pass)
- Pushed to GitHub, ready for deployment

## Architecture
- Express API server (`src/server.ts`) with connection pooling, helmet, CORS, rate limiting
- PostgreSQL with PostGIS/Haversine dual-mode (auto-detects at runtime)
- Versioned migrations (`src/db/migrations/`)
- Shared libs: `src/lib/env.ts` (zod validation), `src/lib/db.ts` (pool + PostGIS detection), `src/lib/logger.ts` (pino)
- Connectors: `packages/connectors/tcgcsv/`, `packages/geo/zip/`, `packages/geo/stores/`
- All connectors report health to `connector_health` table

## Key endpoints
- `GET /health` — DB connectivity check
- `GET /connectors/health` — connector status
- `GET /search?zip=90210&radius=15&store_type=big_box` — store search (radii: 5/15/20)
- `GET /products/search?game=pokemon&type=etb&q=scarlet` — product search with pagination
- `GET /products/:id/signals` — availability signals
- `GET /stores/:id/shipments` — incoming shipments

## Deployment (Render)
- `render.yaml` blueprint exists for one-click deploy
- Render MCP server configured: `claude mcp add --transport http render https://mcp.render.com/mcp --header "Authorization: Bearer rnd_6cYWpYdwmZXBEok3sLt2lVQIDqes"`
- After deploy: run `npm run ingest:zip`, `npm run ingest:stores`, `npm run ingest:tcgcsv` from Render Shell

## Next deployment step
Connect the Render MCP server, then use it to create the database + web service on Render. Or use Render Blueprints dashboard to deploy from `render.yaml`.

## Milestones remaining
- M3: Public Signal Engine (eBay API, TCGPlayer listings, restock scoring)
- M4: Shipment Tracking (USPS/UPS/FedEx connectors, ETA model)
- M5: Alerts & UX (notifications, user preferences, rate limiting)

## Guardrails (hard rules)
- No mock data, no synthetic records, no test fixtures in production paths
- No inferred data without explicit confidence + source
- If a data source fails: endpoint still responds, status is explicit
- Testing uses real recorded API responses, schema validation, connector health checks
