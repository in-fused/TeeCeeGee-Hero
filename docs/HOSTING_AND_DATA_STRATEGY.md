# PackFinder — Hosting & Data Sources

## Current Deployment (Oracle Cloud ARM + Vercel)

| Piece | Host | Notes |
|-------|------|-------|
| **API** | Oracle Cloud ARM instance | Node.js, port 3000, always free |
| **Scrapling proxy** | Oracle Cloud ARM instance | Camoufox browser, port 8787, same machine |
| **Database** | Oracle Cloud ARM instance or managed | PostgreSQL |
| **Frontend** | Vercel | React/Vite static build, free tier |

All services are on the Always Free OCI ARM tier — nothing sleeps, nothing expires.

Set `SCRAPLING_API_URL=http://150.136.153.194:8787` on the API so browser scrapers
(Amazon, Walmart, Target, GameStop, Best Buy) route through the Scrapling proxy
on the same machine.

---

## OCI ARM Setup

### Scrapling proxy (`services/scrapling-proxy/`)
```bash
scp -r services/scrapling-proxy/ opc@150.136.153.194:~/scrapling-proxy/
ssh opc@150.136.153.194
cd ~/scrapling-proxy && bash setup.sh
sudo cp /tmp/scrapling-proxy-patched.service /etc/systemd/system/
sudo systemctl enable --now scrapling-proxy
```

### API (Node.js)
```bash
# On the OCI instance
git clone https://github.com/in-fused/teeceegee-hero.git
cd teeceegee-hero
npm ci --include=dev && npm run build
cp -r src/db/migrations dist/src/db/migrations
node dist/src/db/migrate.js   # run once to create tables
npm start                      # port 3000
```
For production, wrap with a systemd service or use `pm2`.

### OCI Firewall (open both layers)
```bash
# OS firewall (Oracle Linux)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=8787/tcp
sudo firewall-cmd --reload
```
Also open ports 3000 and 8787 in **OCI Console → Networking → VCN → Security Lists**.

---

## Database Options

| Provider | Free Tier | Storage | Notes |
|----------|-----------|---------|-------|
| **OCI local** | Always free | Disk limit | PostgreSQL on the ARM instance itself |
| **Neon** | Yes | 3 GB | Serverless Postgres, best free managed option |
| **Supabase** | Yes | 500 MB | Postgres + extras |
| **CockroachDB** | Yes | 5 GB | Distributed SQL |

**Recommendation**: Neon for a managed DB (no maintenance), or local PostgreSQL on the OCI instance for zero cost and zero latency.

---

## Frontend (Vercel)

Deploy with:
```bash
bash scripts/setup-vercel.sh
```
Set these env vars in Vercel dashboard (Settings → Environment Variables):
- `VITE_API_URL` = `http://150.136.153.194:3000` (or nginx domain)
- `VITE_ADMIN_SECRET` = same value as `ADMIN_SECRET` on the API

---

## API Environment Variables

Set these on the OCI instance (in `.env` or the systemd service file):

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `NODE_ENV` | Yes | `production` |
| `ADMIN_SECRET` | Yes | Password for `/admin/scraper/*` routes |
| `SCRAPLING_API_URL` | Recommended | `http://localhost:8787` (same machine) |
| `SCRAPLING_API_SECRET` | Recommended | Shared secret for Scrapling proxy |
| `BESTBUY_API_KEY` | Optional | https://developer.bestbuy.com/ |
| `POKEMON_TCG_API_KEY` | Optional | https://dev.pokemontcg.io/ |

---

## Inventory / Availability Data Sources

### Tier 1: Already Integrated
- **TCGPlayer**: Product catalog + marketplace listings (scraper working)
- **eBay**: HTML scraper + JSON-LD fallback (working, may rate-limit)
- **OpenStreetMap**: Store locations via Overpass API

### Tier 2: Browser scrapers (need `SCRAPLING_API_URL` set)
- Amazon, Walmart, Target, GameStop, Best Buy
- All wired up — just need the OCI Scrapling proxy reachable

### Tier 3: Future
- Discord/Twitter restock monitoring
- Push notifications for watched products
- User-submitted sightings (`POST /signals`)

---

## Data Freshness Targets

| Data Type | Update Frequency | Source |
|-----------|-----------------|--------|
| Product catalog | Daily | TCGCSV |
| Store locations | Weekly | OpenStreetMap |
| Scraped prices | On-demand | TCGPlayer / eBay / browser scrapers |
| User sightings | Real-time | User submissions (future) |
