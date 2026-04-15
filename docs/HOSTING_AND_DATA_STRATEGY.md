# PackFinder — Backup Hosting & Data Sources Strategy

## Current Deployment (Render)

- **API**: https://packfinder-api.onrender.com (free tier)
- **Frontend**: https://packfinder-web.onrender.com (static site, free)
- **Database**: Render PostgreSQL (free tier, **expires after 90 days**)
- **Risk**: Free databases deleted after 90 days; services sleep after 15min inactivity

---

## Backup Hosting Options (All Free Tier)

### Database Alternatives

| Provider        | Free Tier | Storage | Notes                                                |
| --------------- | --------- | ------- | ---------------------------------------------------- |
| **Neon**        | Yes       | 3GB     | Serverless Postgres, scale-to-zero, best free option |
| **Supabase**    | Yes       | 500MB   | Postgres + Auth + Realtime, great for MVPs           |
| **Railway**     | $5 credit | Limited | Easy setup, no PostGIS by default                    |
| **CockroachDB** | Yes       | 5GB     | Distributed SQL, generous free tier                  |
| **ElephantSQL** | Yes       | 20MB    | Very limited, dev only                               |

**Recommendation**: Migrate to **Neon** before Render's 90-day expiration. Neon has scale-to-zero (no cold start issues) and 3GB free storage.

### API/Backend Alternatives

| Provider               | Free Tier       | Notes                                  |
| ---------------------- | --------------- | -------------------------------------- |
| **Railway**            | $5/month credit | Easy Node.js deployment                |
| **Fly.io**             | 3 shared VMs    | Global edge, good for APIs             |
| **Vercel**             | Serverless only | Great for Next.js, limited for Express |
| **Cloudflare Workers** | 100k req/day    | Edge functions, requires code changes  |
| **Deno Deploy**        | 1M req/month    | Requires Deno runtime                  |

**Recommendation**: **Railway** or **Fly.io** as Render backup.

### Static Site Alternatives

| Provider             | Notes                                |
| -------------------- | ------------------------------------ |
| **Vercel**           | Best for React/Vite, instant deploys |
| **Netlify**          | Great free tier, easy CI/CD          |
| **Cloudflare Pages** | Fast global CDN                      |
| **GitHub Pages**     | Free, limited features               |

**Recommendation**: **Vercel** or **Netlify** for frontend if Render expires.

---

## Migration Checklist (Before Render Expiration)

1. Export database: `pg_dump $DATABASE_URL > backup.sql`
2. Create Neon project and import: `psql $NEON_URL < backup.sql`
3. Update `DATABASE_URL` env var in API deployment
4. Deploy API to Railway/Fly.io if needed
5. Update frontend `VITE_API_URL` to new API host
6. Deploy frontend to Vercel/Netlify if needed

---

## Inventory/Availability Data Sources

### Tier 1: Already Integrated

- **TCGCSV/TCGPlayer**: Product catalog with `tcgplayer_id` for direct marketplace links
- **OpenStreetMap**: Store locations via Overpass API

### Tier 2: Free APIs to Integrate

- **PokemonPriceTracker API** (pokemonpricetracker.com/api)
  - Free tier available
  - 23,000+ cards with pricing
  - Sealed products with market values
  - eBay title parsing

### Tier 3: Crowdsourced/Community

- **User-submitted sightings**: Let users report "I saw this at Store X"
- **Discord webhooks**: Connect to Pokemon restock Discord communities
- **Twitter/X monitoring**: Track @PokeAlerts\_ and similar accounts

### Tier 4: Premium/Paid Services (Future)

- **Poke Alerts** (poke-alerts.com): 100+ store monitoring, in-store stock checker
- **PokéWatcher**: Real-time restock alerts across major retailers
- **BrickSeek**: Walmart/Target inventory (requires subscription for full access)

### Tier 5: Retailer-Specific (Requires Care)

- **Walmart Marketplace API**: Only for sellers, not public inventory
- **Target**: No public API, only app/website shows availability
- **Best Buy API**: Has store availability, requires approval
- **GameStop**: No public API

---

## Legal Considerations

1. **Scraping**: Avoid scraping retailer sites directly — violates ToS
2. **APIs**: Use official APIs when available (TCGPlayer, PokemonPriceTracker)
3. **Crowdsourcing**: Safest approach — users voluntarily submit data
4. **Rate Limiting**: Always respect API rate limits
5. **Caching**: Cache external API responses to reduce load

---

## Implementation Priority

### Phase 1 (Current Sprint)

- [x] TCGPlayer product links via `tcgplayer_id`
- [ ] User sighting submission endpoint (`POST /signals`)
- [ ] Display signals on product/store pages

### Phase 2 (Next Sprint)

- [ ] PokemonPriceTracker API integration for pricing
- [ ] eBay search links for products
- [ ] Signal confidence scoring

### Phase 3 (Future)

- [ ] Discord/Twitter restock monitoring
- [ ] Push notifications for watched products
- [ ] Store-specific inventory patterns (ML-based)

---

## Data Freshness Targets

| Data Type       | Update Frequency   | Source              |
| --------------- | ------------------ | ------------------- |
| Product catalog | Daily              | TCGCSV              |
| Store locations | Weekly             | OpenStreetMap       |
| User sightings  | Real-time          | User submissions    |
| Pricing data    | Hourly (future)    | PokemonPriceTracker |
| Restock signals | Real-time (future) | Community feeds     |
