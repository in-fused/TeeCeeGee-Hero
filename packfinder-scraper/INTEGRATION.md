# PackFinder Scraper Integration Guide

This guide shows how to integrate the scraper module into your existing PackFinder backend.

## Step 1: Copy Files to Your Project

Copy the scraper module into your `src/` directory:

```bash
# From your project root
cp -r /path/to/packfinder-scraper/src/scraper src/
cp -r /path/to/packfinder-scraper/src/retailers src/
cp -r /path/to/packfinder-scraper/src/routes src/scraper-routes
cp -r /path/to/packfinder-scraper/src/db/migrations src/db/
cp /path/to/packfinder-scraper/src/types/index.ts src/types/scraper.ts
```

## Step 2: Install Dependencies

Add to your existing `package.json`:

```bash
npm install axios axios-retry cheerio https-proxy-agent
npm install -D @types/cheerio
```

## Step 3: Run Database Migrations

```bash
# Run the migration
psql $DATABASE_URL -f src/db/migrations/001_scraped_listings.sql
```

## Step 4: Update Your Server

Modify `src/server.ts` to add the scraper routes:

```typescript
import { createScraperRouter, createReplenishmentRouter } from './scraper-routes';
import { initialize as initializeScraper } from './retailers';
import { setPool } from './db';

// ... existing imports ...

// Initialize scraper with your pool
setPool(pool);
initializeScraper();

// Add routes
app.use('/admin/scraper', createScraperRouter(pool));
app.use('/admin/replenishment', createReplenishmentRouter(pool));
```

## Step 5: Update Admin Routes

If you want to add scraper endpoints to your existing admin routes:

```typescript
// src/routes/admin.ts
import { createScraperRouter } from '../scraper-routes/scraper';
import { createReplenishmentRouter } from '../scraper-routes/replenishment';

// ... existing code ...

// Add scraper routes under admin
router.use('/scraper', createScraperRouter(pool));
router.use('/replenishment', createReplenishmentRouter(pool));
```

## Step 6: Environment Variables

Add to your `.env`:

```bash
# Scraper settings
LOG_LEVEL=info
LOGS_DIR=./logs
```

## Usage Examples

### Search for Products

```bash
curl -X GET "https://your-api.com/admin/scraper/search?q=charizard&game=pokemon&inStock=true" \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "externalId": "12345",
      "retailer": "tcgplayer",
      "name": "Charizard - Base Set",
      "price": 299.99,
      "status": "in_stock",
      "productUrl": "https://www.tcgplayer.com/product/12345"
    }
  ],
  "meta": {
    "total": 1
  }
}
```

### Scrape a Set

```bash
curl -X POST "https://your-api.com/admin/scraper/set" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "setName": "Scarlet & Violet",
    "game": "pokemon"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "jobId": "uuid-here",
    "message": "Scraping job started"
  }
}
```

### Check Job Status

```bash
curl -X GET "https://your-api.com/admin/scraper/jobs/uuid-here" \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

### Get Replenishment Needs

```bash
curl -X GET "https://your-api.com/admin/replenishment/needs" \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-here",
      "productName": "Charizard",
      "currentStock": 2,
      "desiredStock": 20,
      "shortage": 18,
      "bestPrice": 299.99,
      "bestRetailer": "tcgplayer",
      "priority": "high"
    }
  ]
}
```

### Create Purchase Order

```bash
curl -X POST "https://your-api.com/admin/replenishment/orders" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "retailer": "tcgplayer",
    "items": [
      {
        "listingId": "uuid-here",
        "name": "Charizard",
        "quantity": 18,
        "unitPrice": 299.99,
        "total": 5399.82
      }
    ]
  }'
```

## Scheduled Jobs

Set up cron jobs for regular scraping:

```bash
# Crontab example
# Scrape trending products every hour
0 * * * * curl -X POST "https://your-api.com/admin/scraper/set" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"setName": "trending", "game": "pokemon"}'

# Analyze inventory for replenishment needs daily at 6 AM
0 6 * * * curl -X POST "https://your-api.com/admin/replenishment/analyze" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"inventory": [...]}'
```

## Frontend Integration

Your existing frontend can consume these endpoints:

```typescript
// Example: Search products
async function searchProducts(query: string, game: string) {
  const response = await fetch(
    `/admin/scraper/search?q=${encodeURIComponent(query)}&game=${game}`,
    {
      headers: {
        'Authorization': `Bearer ${ADMIN_SECRET}`
      }
    }
  );
  return response.json();
}

// Example: Get replenishment needs
async function getReplenishmentNeeds() {
  const response = await fetch('/admin/replenishment/needs', {
    headers: {
      'Authorization': `Bearer ${ADMIN_SECRET}`
    }
  });
  return response.json();
}
```

## Troubleshooting

### Rate Limiting

If you're getting blocked, increase the rate limit:

```typescript
// In your scraper config
const scraper = new GenericRetailerScraper({
  ...config,
  rateLimitMs: 3000, // Increase from default
});
```

### Proxy Support

For retailers that block your IP, use a proxy:

```typescript
const scraper = new ScraperClient({
  useProxy: true,
  proxyUrl: 'http://user:pass@proxy:8080',
});
```

### Debug Logging

Enable debug logging:

```bash
LOG_LEVEL=debug npm start
```

## File Structure After Integration

```
src/
├── scraper/           # Core scraper with fingerprint spoofing
│   ├── client.ts
│   ├── fingerprint.ts
│   └── logger.ts
├── retailers/         # Retailer-specific scrapers
│   ├── base.ts
│   ├── tcgplayer.ts
│   ├── generic.ts
│   └── index.ts
├── scraper-routes/    # API routes
│   ├── scraper.ts
│   └── replenishment.ts
├── db/
│   └── migrations/
│       └── 001_scraped_listings.sql
├── types/
│   └── scraper.ts     # Type definitions
├── routes/
│   └── admin.ts       # Add scraper routes here
└── server.ts          # Initialize scraper
```
