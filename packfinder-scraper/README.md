# PackFinder Scraper Module

A comprehensive scraping and inventory replenishment system for Pokémon, One Piece, and other TCG products. Features browser fingerprint spoofing to avoid detection when scraping retailer websites.

## Features

### 🕵️ Browser Fingerprint Spoofing
- Rotating User-Agent strings
- Realistic browser headers (Sec-CH-UA, Accept-Language, etc.)
- Simulated viewport and screen dimensions
- Randomized timing patterns
- Referer header rotation

### 🛒 Multi-Retailer Support
- **TCGplayer** (API-based)
- **Amazon**
- **eBay**
- **Walmart**
- **Target**
- **GameStop**
- **Best Buy**
- **Collector's Cache**
- **Troll and Toad**
- Extensible for custom retailers

### 📊 Inventory Tracking
- Real-time price monitoring
- Stock level tracking
- Price history
- Change detection (price drops, restocks)

### 📦 Replenishment Management
- Auto-generated shortage alerts
- Best price sourcing across retailers
- Purchase order creation
- Order tracking

## Installation

```bash
npm install @packfinder/scraper
```

## Database Setup

Run the migration to create the required tables:

```bash
psql $DATABASE_URL -f src/db/migrations/001_scraped_listings.sql
```

## Usage

### Initialize the Module

```typescript
import { Pool } from 'pg';
import { initialize, createScraperRouter, createReplenishmentRouter } from '@packfinder/scraper';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Initialize with your Postgres pool
initialize(pool);

// Add routes to your Express app
app.use('/admin/scraper', createScraperRouter(pool));
app.use('/admin/replenishment', createReplenishmentRouter(pool));
```

### Search Products Across Retailers

```bash
curl -X GET "https://your-api.com/admin/scraper/search?q=charizard&game=pokemon&inStock=true" \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

### Scrape a Single Product

```bash
curl -X POST "https://your-api.com/admin/scraper/product" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.tcgplayer.com/product/12345",
    "retailer": "tcgplayer"
  }'
```

### Scrape an Entire Set

```bash
curl -X POST "https://your-api.com/admin/scraper/set" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "setName": "Scarlet & Violet",
    "game": "pokemon",
    "retailers": ["tcgplayer", "amazon"]
  }'
```

### Bulk Scrape URLs

```bash
curl -X POST "https://your-api.com/admin/scraper/bulk" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.tcgplayer.com/product/12345",
      "https://www.tcgplayer.com/product/12346"
    ],
    "retailer": "tcgplayer"
  }'
```

### Get Replenishment Needs

```bash
curl -X GET "https://your-api.com/admin/replenishment/needs" \
  -H "Authorization: Bearer $ADMIN_SECRET"
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
        "quantity": 10,
        "unitPrice": 50.00,
        "total": 500.00
      }
    ]
  }'
```

## API Endpoints

### Scraper Routes (`/admin/scraper`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Get scraper status and stats |
| GET | `/retailers` | List available retailers |
| POST | `/reset` | Reset scraper request counts |
| GET | `/search` | Search products across retailers |
| POST | `/product` | Scrape a single product URL |
| POST | `/set` | Scrape all products for a set |
| POST | `/bulk` | Bulk scrape multiple URLs |
| GET | `/listings` | Get scraped listings |
| GET | `/listings/:id` | Get a specific listing |
| POST | `/listings/:id/refresh` | Refresh a listing |
| GET | `/changes` | Get recent inventory changes |
| GET | `/jobs` | Get scraping jobs |
| GET | `/jobs/:id` | Get a specific job |

### Replenishment Routes (`/admin/replenishment`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/needs` | Get replenishment needs |
| POST | `/needs` | Create a replenishment need |
| POST | `/needs/:id/resolve` | Resolve a need |
| POST | `/analyze` | Analyze inventory for shortages |
| GET | `/orders` | Get purchase orders |
| POST | `/orders` | Create a purchase order |
| GET | `/orders/:id` | Get a specific order |
| PATCH | `/orders/:id/status` | Update order status |
| GET | `/source` | Find best prices for a product |
| POST | `/auto-order` | Auto-create orders for needs |

## Database Schema

### Core Tables

- `scraped_listings` - All scraped product listings
- `inventory_snapshots` - Historical inventory levels
- `inventory_changes` - Detected changes (price, stock)
- `price_history` - Time-series price data
- `price_alerts` - User-configured alerts
- `replenishment_needs` - Auto-generated shortage alerts
- `purchase_orders` - Purchase order tracking
- `purchase_order_items` - Individual order items
- `scraping_jobs` - Job execution tracking

### Triggers

- `detect_listing_changes` - Automatically records changes when listings are updated
- `record_new_listing` - Records initial snapshot on insert

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db
ADMIN_SECRET=your-secret-key

# Optional
LOG_LEVEL=info          # debug, info, warn, error
LOGS_DIR=./logs         # Log file directory
NODE_ENV=production     # production or development
```

## Custom Retailer Scraper

```typescript
import { GenericRetailerScraper } from '@packfinder/scraper';

const customScraper = new GenericRetailerScraper({
  name: 'my_retailer',
  baseUrl: 'https://www.myretailer.com',
  rateLimitMs: 1500,
  searchUrlTemplate: 'https://www.myretailer.com/search?q={query}&page={page}',
  selectors: {
    productName: '.product-title',
    price: '.product-price',
    availability: '.stock-status',
    image: '.product-image img',
    productGrid: '.product-card',
    productLink: 'a.product-link',
  },
});

// Use the scraper
const listings = await customScraper.searchProducts('pikachu', 'pokemon');
```

## Rate Limiting

Each scraper has configurable rate limiting to avoid being blocked:

- **TCGplayer**: 1000ms between requests
- **Amazon**: 2000ms between requests
- **eBay**: 1500ms between requests
- **Walmart**: 2000ms between requests
- **Target**: 2000ms between requests
- **GameStop**: 1500ms between requests
- **Best Buy**: 2000ms between requests

## License

MIT
