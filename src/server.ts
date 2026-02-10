import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './lib/env';
import { pool, healthCheck, hasPostGIS, shutdown } from './lib/db';
import { logger } from './lib/logger';
import { adminRouter } from './routes/admin';
import { webhookRouter } from './routes/webhooks';
import { scraperRouter } from './routes/scraper';
import { replenishmentRouter } from './routes/replenishment';
import { initializeScrapers, searchAllRetailers } from './retailers';
import * as scraperDb from './db/scraper';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  }),
);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({ method: req.method, url: req.url }, 'request');
  next();
});

// Health check with DB connectivity
app.get('/health', async (_req: Request, res: Response) => {
  const dbOk = await healthCheck();
  const status = dbOk ? 'OK' : 'DEGRADED';
  res.status(dbOk ? 200 : 503).json({
    status,
    db: dbOk ? 'connected' : 'unreachable',
    timestamp: new Date().toISOString(),
  });
});

// Connector health — per guardrails, explicit failure status
app.get('/connectors/health', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM connector_health ORDER BY connector_name');
    res.json({ connectors: result.rows });
  } catch (err) {
    logger.error({ err }, 'connector health query failed');
    res.status(500).json({ status: 'ERROR', message: 'Unable to retrieve connector health' });
  }
});

// Product search with filtering
app.get('/products/search', async (req: Request, res: Response) => {
  try {
    const game = req.query.game as string | undefined;
    const productType = req.query.type as string | undefined;
    const language = req.query.language as string | undefined;
    const q = req.query.q as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (game) {
      conditions.push(`game = $${paramIdx++}`);
      params.push(game);
    }
    if (productType) {
      conditions.push(`product_type = $${paramIdx++}`);
      params.push(productType);
    }
    if (language) {
      conditions.push(`language = $${paramIdx++}`);
      params.push(language);
    }
    if (q) {
      conditions.push(`to_tsvector('english', normalized_name) @@ plainto_tsquery($${paramIdx++})`);
      params.push(q);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM products ${where}`, params);

    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx;
    const queryParams = [...params, limit, offset];

    const result = await pool.query(
      `SELECT * FROM products ${where} ORDER BY name LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams,
    );

    if (!result.rows.length) {
      res.json({ status: 'NO_DATA_AVAILABLE', total: 0, products: [] });
      return;
    }

    res.json({
      total: Number(countResult.rows[0].total),
      limit,
      offset,
      products: result.rows,
    });
  } catch (err) {
    logger.error({ err }, 'product search failed');
    res.status(500).json({ status: 'ERROR', message: 'Product search failed' });
  }
});

// Store search by ZIP + radius using PostGIS
const VALID_RADII = [5, 15, 20];

app.get('/search', async (req: Request, res: Response) => {
  try {
    const zip = req.query.zip as string;
    const radiusParam = Number(req.query.radius || 5);
    const storeType = req.query.store_type as string | undefined;

    if (!zip || !/^\d{5}$/.test(zip)) {
      res.status(400).json({ error: 'Valid 5-digit ZIP code required' });
      return;
    }

    const radius = VALID_RADII.includes(radiusParam) ? radiusParam : 5;
    const radiusMeters = radius * 1609.344;

    const z = await pool.query(
      'SELECT latitude, longitude, location FROM zip_centroids WHERE zip=$1',
      [zip],
    );

    if (!z.rows.length) {
      res.json({
        status: 'NO_DATA_AVAILABLE',
        message: `ZIP ${zip} not found in database`,
        zip,
        radius,
        stores: [],
      });
      return;
    }

    const { latitude, longitude } = z.rows[0];

    const usePostGIS = await hasPostGIS();

    let stores;
    if (usePostGIS) {
      let storeFilter = '';
      const params: (number | string)[] = [latitude, longitude, radiusMeters];
      if (storeType) {
        storeFilter = 'AND store_type = $4';
        params.push(storeType);
      }
      stores = await pool.query(
        `SELECT id, name, store_type, latitude, longitude, address, city, state, zip, source,
                ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1609.344 AS distance_miles
         FROM stores
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
         ${storeFilter}
         ORDER BY distance_miles`,
        params,
      );
    } else {
      // Haversine fallback when PostGIS is not available
      let storeFilter = '';
      const params: (number | string)[] = [latitude, longitude, radius];
      if (storeType) {
        storeFilter = 'AND store_type = $4';
        params.push(storeType);
      }
      stores = await pool.query(
        `SELECT id, name, store_type, latitude, longitude, address, city, state, zip, source,
                (3959 * acos(
                  LEAST(1, cos(radians($1)) * cos(radians(latitude)) *
                  cos(radians(longitude) - radians($2)) +
                  sin(radians($1)) * sin(radians(latitude)))
                )) AS distance_miles
         FROM stores
         WHERE (3959 * acos(
                  LEAST(1, cos(radians($1)) * cos(radians(latitude)) *
                  cos(radians(longitude) - radians($2)) +
                  sin(radians($1)) * sin(radians(latitude)))
                )) <= $3
         ${storeFilter}
         ORDER BY distance_miles`,
        params,
      );
    }

    // Include known TCG sealed products with marketplace links
    let products: unknown[] = [];
    try {
      const productResult = await pool.query(
        `SELECT id, name, game, product_type, image_url, market_price, tcgplayer_id
         FROM products
         WHERE product_type IN ('etb', 'booster_box', 'bundle', 'tin', 'collection_box', 'blister')
         ORDER BY name
         LIMIT 50`,
      );
      products = productResult.rows.map((p: Record<string, unknown>) => ({
        ...p,
        links: {
          tcgplayer: p.tcgplayer_id
            ? `https://www.tcgplayer.com/product/${p.tcgplayer_id}`
            : null,
          ebay_search: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(String(p.name))}&_sacat=183454`,
        },
      }));
    } catch {
      // products table may not exist or be empty — continue without
    }

    // Include scraped listings with real prices and stock from all retailers
    let listings: unknown[] = [];
    try {
      const listingResult = await pool.query(
        `SELECT id, name, game, product_type, image_url, price, currency, status,
                retailer, product_url, set_name, condition, quantity, scraped_at
         FROM scraped_listings
         WHERE is_active = TRUE
           AND product_type IN ('etb', 'booster_box', 'bundle', 'tin', 'collection_box', 'blister', 'booster_pack')
           AND price > 0
         ORDER BY scraped_at DESC
         LIMIT 60`,
      );
      listings = listingResult.rows;
    } catch {
      // scraped_listings table may not exist — continue without
    }

    res.json({
      zip,
      radius,
      center: { latitude, longitude },
      total: stores.rows.length,
      stores: stores.rows,
      products,
      listings,
    });
  } catch (err) {
    logger.error({ err }, 'store search failed');
    res.status(500).json({ status: 'ERROR', message: 'Store search failed' });
  }
});

// Availability signals for a product
app.get('/products/:id/signals', async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    if (!productId || isNaN(productId)) {
      res.status(400).json({ error: 'Valid product ID required' });
      return;
    }

    const result = await pool.query(
      `SELECT s.*, st.name as store_name
       FROM availability_signals s
       LEFT JOIN stores st ON s.store_id = st.id
       WHERE s.product_id = $1
       ORDER BY s.observed_at DESC
       LIMIT 50`,
      [productId],
    );

    res.json({ product_id: productId, signals: result.rows });
  } catch (err) {
    logger.error({ err }, 'signals query failed');
    res.status(500).json({ status: 'ERROR', message: 'Signal query failed' });
  }
});

// Shipments arriving at a store
app.get('/stores/:id/shipments', async (req: Request, res: Response) => {
  try {
    const storeId = Number(req.params.id);
    if (!storeId || isNaN(storeId)) {
      res.status(400).json({ error: 'Valid store ID required' });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM shipments
       WHERE destination_store_id = $1
       ORDER BY eta ASC NULLS LAST
       LIMIT 50`,
      [storeId],
    );

    res.json({ store_id: storeId, shipments: result.rows });
  } catch (err) {
    logger.error({ err }, 'shipments query failed');
    res.status(500).json({ status: 'ERROR', message: 'Shipment query failed' });
  }
});

// Get single product with marketplace links
app.get('/products/:id', async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    if (!productId || isNaN(productId)) {
      res.status(400).json({ error: 'Valid product ID required' });
      return;
    }

    const result = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);

    if (!result.rows.length) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const product = result.rows[0];

    // Build marketplace links
    const links = {
      tcgplayer: `https://www.tcgplayer.com/product/${product.tcgplayer_id}`,
      ebay_search: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(product.name)}&_sacat=0`,
    };

    res.json({ ...product, links });
  } catch (err) {
    logger.error({ err }, 'product detail query failed');
    res.status(500).json({ status: 'ERROR', message: 'Product query failed' });
  }
});

// Submit availability signal (user sighting)
app.post('/signals', async (req: Request, res: Response) => {
  try {
    const { product_id, store_id, signal_type, source, notes } = req.body;

    // Validate required fields
    if (!product_id || !store_id) {
      res.status(400).json({ error: 'product_id and store_id are required' });
      return;
    }

    const productIdNum = Number(product_id);
    const storeIdNum = Number(store_id);

    if (isNaN(productIdNum) || isNaN(storeIdNum)) {
      res.status(400).json({ error: 'product_id and store_id must be numbers' });
      return;
    }

    // Verify product and store exist
    const [productCheck, storeCheck] = await Promise.all([
      pool.query('SELECT id FROM products WHERE id = $1', [productIdNum]),
      pool.query('SELECT id FROM stores WHERE id = $1', [storeIdNum]),
    ]);

    if (!productCheck.rows.length) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    if (!storeCheck.rows.length) {
      res.status(404).json({ error: 'Store not found' });
      return;
    }

    // Default signal type and confidence
    const type = signal_type || 'user_sighting';
    const confidence = type === 'user_sighting' ? 0.7 : 0.5;

    const result = await pool.query(
      `INSERT INTO availability_signals (product_id, store_id, signal_type, confidence, source, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        productIdNum,
        storeIdNum,
        type,
        confidence,
        source || 'user_submission',
        notes ? JSON.stringify({ notes }) : null,
      ],
    );

    logger.info({ product_id: productIdNum, store_id: storeIdNum, type }, 'Signal submitted');
    res.status(201).json({ status: 'OK', signal: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'signal submission failed');
    res.status(500).json({ status: 'ERROR', message: 'Signal submission failed' });
  }
});

// Get stores where a product has been sighted
app.get('/products/:id/stores', async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    if (!productId || isNaN(productId)) {
      res.status(400).json({ error: 'Valid product ID required' });
      return;
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (s.id)
         s.id, s.name, s.store_type, s.latitude, s.longitude,
         s.address, s.city, s.state, s.zip,
         sig.signal_type, sig.confidence, sig.observed_at
       FROM stores s
       INNER JOIN availability_signals sig ON sig.store_id = s.id
       WHERE sig.product_id = $1
       ORDER BY s.id, sig.observed_at DESC`,
      [productId],
    );

    res.json({ product_id: productId, total: result.rows.length, stores: result.rows });
  } catch (err) {
    logger.error({ err }, 'product stores query failed');
    res.status(500).json({ status: 'ERROR', message: 'Query failed' });
  }
});

// Get products sighted at a store
app.get('/stores/:id/products', async (req: Request, res: Response) => {
  try {
    const storeId = Number(req.params.id);
    if (!storeId || isNaN(storeId)) {
      res.status(400).json({ error: 'Valid store ID required' });
      return;
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (p.id)
         p.id, p.tcgplayer_id, p.name, p.game, p.product_type, p.image_url,
         sig.signal_type, sig.confidence, sig.observed_at
       FROM products p
       INNER JOIN availability_signals sig ON sig.product_id = p.id
       WHERE sig.store_id = $1
       ORDER BY p.id, sig.observed_at DESC`,
      [storeId],
    );

    // Add marketplace links
    const products = result.rows.map((p) => ({
      ...p,
      links: {
        tcgplayer: `https://www.tcgplayer.com/product/${p.tcgplayer_id}`,
        ebay_search: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(p.name)}&_sacat=0`,
      },
    }));

    res.json({ store_id: storeId, total: products.length, products });
  } catch (err) {
    logger.error({ err }, 'store products query failed');
    res.status(500).json({ status: 'ERROR', message: 'Query failed' });
  }
});

// Price history for a product
app.get('/products/:id/prices', async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    if (!productId || isNaN(productId)) {
      res.status(400).json({ error: 'Valid product ID required' });
      return;
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const result = await pool.query(
      `SELECT price, source, observed_at
       FROM price_history
       WHERE product_id = $1
       ORDER BY observed_at DESC
       LIMIT $2`,
      [productId, limit],
    );

    res.json({ product_id: productId, total: result.rows.length, prices: result.rows });
  } catch (err) {
    logger.error({ err }, 'price history query failed');
    res.status(500).json({ status: 'ERROR', message: 'Price history query failed' });
  }
});

// Stock levels for a product across stores
app.get('/products/:id/stock', async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.id);
    if (!productId || isNaN(productId)) {
      res.status(400).json({ error: 'Valid product ID required' });
      return;
    }

    const result = await pool.query(
      `SELECT sl.*, s.name as store_name, s.store_type, s.city, s.state
       FROM stock_levels sl
       JOIN stores s ON sl.store_id = s.id
       WHERE sl.product_id = $1
       ORDER BY sl.quantity DESC`,
      [productId],
    );

    res.json({ product_id: productId, total: result.rows.length, stock: result.rows });
  } catch (err) {
    logger.error({ err }, 'stock levels query failed');
    res.status(500).json({ status: 'ERROR', message: 'Stock levels query failed' });
  }
});

// Stock levels for a store (all products)
app.get('/stores/:id/stock', async (req: Request, res: Response) => {
  try {
    const storeId = Number(req.params.id);
    if (!storeId || isNaN(storeId)) {
      res.status(400).json({ error: 'Valid store ID required' });
      return;
    }

    const lowStockOnly = req.query.low_stock === 'true';

    let query = `SELECT sl.*, p.name as product_name, p.game, p.product_type, p.market_price, p.image_url
       FROM stock_levels sl
       JOIN products p ON sl.product_id = p.id
       WHERE sl.store_id = $1`;

    if (lowStockOnly) {
      query += ' AND sl.quantity <= sl.reorder_point';
    }

    query += ' ORDER BY sl.quantity ASC';

    const result = await pool.query(query, [storeId]);

    res.json({ store_id: storeId, total: result.rows.length, stock: result.rows });
  } catch (err) {
    logger.error({ err }, 'store stock query failed');
    res.status(500).json({ status: 'ERROR', message: 'Store stock query failed' });
  }
});

// ── Public prices endpoint ──────────────────────────────────────────
// Live price search across all retailers — no admin auth required.
// Returns cached results if fresh, otherwise fetches live.
app.get('/prices/search', async (req: Request, res: Response) => {
  const q = req.query.q as string;
  const game = req.query.game as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  if (!q || q.length < 2) {
    res.status(400).json({ error: 'Query param "q" is required (min 2 chars)' });
    return;
  }

  try {
    // 1. Check for recent cached results first (less than 1 hour old)
    let cached: unknown[] = [];
    try {
      const cacheResult = await pool.query(
        `SELECT id, name, game, product_type, image_url, price, currency, status,
                retailer, product_url, set_name, condition, quantity, scraped_at
         FROM scraped_listings
         WHERE is_active = TRUE
           AND to_tsvector('english', name || ' ' || COALESCE(set_name, '')) @@ plainto_tsquery('english', $1)
           AND scraped_at > NOW() - INTERVAL '1 hour'
         ORDER BY price ASC
         LIMIT $2`,
        [q, limit],
      );
      cached = cacheResult.rows;
    } catch {
      // scraped_listings table may not exist yet — that's ok
    }

    // 2. If we have enough cached results, return them immediately
    if (cached.length >= 3) {
      res.json({ results: cached, source: 'cache', total: cached.length });
      return;
    }

    // 3. No cache — do a live search across TCGPlayer + eBay (fast retailers)
    const { results, errors } = await searchAllRetailers(q, game as any, {
      retailers: ['tcgplayer', 'ebay'],
      limit,
    });

    // 4. Save results to DB in background (for future cache hits + changes tracking)
    if (results.length > 0) {
      Promise.all(
        results.map((listing) =>
          scraperDb.upsertListing(listing).catch((e) => {
            logger.debug({ e, name: listing.name }, 'Failed to cache listing');
          }),
        ),
      ).catch(() => {});
    }

    // 5. Normalize to snake_case for frontend consistency
    const normalized = results.map((r) => ({
      id: r.id || null,
      name: r.name,
      game: r.game,
      product_type: r.productType,
      image_url: r.imageUrl || null,
      price: r.price,
      currency: r.currency,
      status: r.status,
      retailer: r.retailer,
      product_url: r.productUrl,
      set_name: r.setName || null,
      condition: r.condition,
      quantity: r.quantity || null,
      scraped_at: r.scrapedAt?.toISOString() || new Date().toISOString(),
    }));

    res.json({
      results: normalized,
      source: 'live',
      total: normalized.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    logger.error({ err, q }, 'Price search failed');
    res.status(500).json({ error: 'Price search failed' });
  }
});

// Public cached listings endpoint — returns recently scraped data
app.get('/prices/recent', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, game, product_type, image_url, price, currency, status,
              retailer, product_url, set_name, condition, quantity, scraped_at
       FROM scraped_listings
       WHERE is_active = TRUE AND price > 0
       ORDER BY scraped_at DESC
       LIMIT 50`,
    );
    res.json({ results: result.rows, total: result.rows.length });
  } catch {
    res.json({ results: [], total: 0 });
  }
});

// Public stats endpoint — listing counts + retailer breakdown, no admin auth
app.get('/prices/stats', async (_req: Request, res: Response) => {
  try {
    const [total, active, byRetailer, changes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as count FROM scraped_listings'),
      pool.query('SELECT COUNT(*)::int as count FROM scraped_listings WHERE is_active = TRUE'),
      pool.query(
        `SELECT retailer, COUNT(*)::int as count
         FROM scraped_listings WHERE is_active = TRUE
         GROUP BY retailer ORDER BY count DESC`,
      ),
      pool.query(
        "SELECT COUNT(*)::int as count FROM inventory_changes WHERE detected_at > NOW() - INTERVAL '24 hours'",
      ),
    ]);
    res.json({
      totalListings: total.rows[0].count,
      activeListings: active.rows[0].count,
      byRetailer: byRetailer.rows,
      recentChanges: changes.rows[0].count,
    });
  } catch {
    res.json({ totalListings: 0, activeListings: 0, byRetailer: [], recentChanges: 0 });
  }
});

// Public recent changes endpoint — price drops, restocks visible to everyone
app.get('/prices/changes', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  try {
    const result = await pool.query(
      `SELECT c.id, c.change_type, c.old_value, c.new_value, c.detected_at, c.retailer,
              l.name, l.game, l.product_url, l.price as current_price, l.status as current_status
       FROM inventory_changes c
       JOIN scraped_listings l ON c.listing_id = l.id
       ORDER BY c.detected_at DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ results: result.rows, total: result.rows.length });
  } catch {
    res.json({ results: [], total: 0 });
  }
});

// Webhook management endpoints
app.use('/webhooks', webhookRouter);

// Admin endpoints (ingestion triggers)
app.use('/admin', adminRouter);

// Scraper + replenishment endpoints (admin-gated)
app.use('/admin/scraper', scraperRouter);
app.use('/admin/replenishment', replenishmentRouter);

// Initialize scraper registry
initializeScrapers();

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ status: 'ERROR', message: 'Internal server error' });
});

// Graceful shutdown
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'PackFinder API started');
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  server.close();
  await shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down');
  server.close();
  await shutdown();
  process.exit(0);
});

export { app };
