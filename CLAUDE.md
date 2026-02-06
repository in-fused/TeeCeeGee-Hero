# PackFinder — Project Memory

> **This file is automatically read on every Claude Code session startup.**

## Quick Reference

| Item              | Value                                              |
| ----------------- | -------------------------------------------------- |
| **Live API**      | https://packfinder-api.onrender.com                |
| **Live Frontend** | https://packfinder-web.onrender.com                |
| **Admin Secret**  | `dd336adc5d69eacd10c0d534fbc161548be88db1e1da6d96` |
| **Tests**         | 74 passing (`npm test`)                            |
| **Build**         | `npm run build` (TypeScript clean)                 |

---

## What This Is

TCG inventory tracker for **Pokemon** and **One Piece** sealed products:

- Find retail stores near a ZIP code
- Search product catalog (ETBs, booster boxes, tins, etc.)
- Track availability via crowdsourced sightings
- Marketplace links (TCGplayer, eBay) for online purchase

---

## Architecture

```
Backend: Node.js + Express + PostgreSQL (PostGIS optional)
Frontend: React 19 + Vite 7 + Tailwind v4 + Leaflet maps
Hosting: Render free tier (API + static site)
```

### Key Files

- `src/server.ts` — All API routes
- `src/ingest/*.ts` — Data ingest modules (ZIP, stores, products)
- `src/lib/db.ts` — PostgreSQL pool + PostGIS auto-detection
- `web/src/pages/` — React pages (Home, Search, MapView)
- `web/src/components/ProductCard.tsx` — Expandable cards with marketplace links

---

## API Endpoints

### Public

| Method | Endpoint                                 | Description                    |
| ------ | ---------------------------------------- | ------------------------------ |
| GET    | `/health`                                | DB connectivity                |
| GET    | `/search?zip=90210&radius=15`            | Find stores near ZIP           |
| GET    | `/products/search?game=pokemon&type=etb` | Search products                |
| GET    | `/products/:id`                          | Product with marketplace links |
| GET    | `/products/:id/stores`                   | Stores with product sightings  |
| GET    | `/stores/:id/products`                   | Products sighted at store      |
| POST   | `/signals`                               | Submit availability signal     |

### Admin (requires Bearer token)

| Method | Endpoint               | Description          |
| ------ | ---------------------- | -------------------- |
| POST   | `/admin/ingest/zip`    | Load ZIP centroids   |
| POST   | `/admin/ingest/stores` | Load stores from OSM |
| POST   | `/admin/ingest/tcgcsv` | Load product catalog |
| POST   | `/admin/ingest/all`    | Run all ingests      |

**Trigger ingest (PowerShell):**

```powershell
Invoke-WebRequest -Uri "https://packfinder-api.onrender.com/admin/ingest/all" -Method POST -Headers @{ "Authorization" = "Bearer dd336adc5d69eacd10c0d534fbc161548be88db1e1da6d96" }
```

---

## Current Data State

- **33,791** ZIP codes loaded
- **220+** stores near Los Angeles
- **3,337** sealed products (299 Pokemon ETBs, 204 One Piece)
- **All 3 connectors** healthy

---

## Data Sources

| Source                 | What              | Status                      |
| ---------------------- | ----------------- | --------------------------- |
| US Census Bureau       | ZIP centroids     | ✅ Working                  |
| OpenStreetMap Overpass | Store locations   | ✅ Working                  |
| TCGCSV API             | Product catalog   | ✅ Working                  |
| TCGplayer API          | Real-time pricing | ❌ Needs affiliate approval |
| eBay Browse API        | Listings          | ❌ Not implemented          |
| Crowdsourced signals   | User sightings    | ✅ Endpoint ready           |

---

## Frontend Features

1. **Product Search** (`/search`)
   - Filter by game, product type
   - Click card to expand → TCGplayer + eBay links

2. **Store Map** (`/map`)
   - Enter ZIP → see nearby stores on map
   - Click store → see products sighted there
   - Direct links to buy online

---

## Database Tables

```sql
zip_centroids    -- 33,791 ZIP codes with lat/lng
stores           -- Retail locations (Target, Walmart, GameStop, etc.)
products         -- TCG sealed products
availability_signals -- Crowdsourced inventory sightings
connector_health -- Data source status
```

---

## Testing

```bash
npm test          # 74 tests
npm run build     # TypeScript compile
cd web && npm run build  # Frontend build
```

---

## Guardrails (Hard Rules)

1. **No mock data** in production paths
2. **No inferred data** without explicit confidence + source
3. **If data source fails**, endpoint still responds with explicit status
4. **Extensive tests** between commits — never push broken code
5. **Preserve UI** — zero regressions unless explicitly requested

---

## Related Branch

Additional inventory/scraping code at:

- **Branch:** `kimi-api`
- **URL:** https://github.com/in-fused/TeeCeeGee-Hero/tree/kimi-api

This branch has code for inventory management APIs that may be integrated.

---

## Milestones

- [x] M1: Core API + Store Finder
- [x] M2: Product Catalog + Frontend UI
- [ ] M3: Real-time inventory signals (eBay API, TCGplayer)
- [ ] M4: Shipment tracking (USPS/UPS/FedEx)
- [ ] M5: Alerts & notifications

---

## Backup Hosting Options

See `docs/HOSTING_AND_DATA_STRATEGY.md` for free tier alternatives:

- Neon (PostgreSQL)
- Supabase
- Railway
- Fly.io
