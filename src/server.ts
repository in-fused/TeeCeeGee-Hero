import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './lib/env';
import { pool, healthCheck, hasPostGIS, shutdown } from './lib/db';
import { logger } from './lib/logger';

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
      conditions.push(
        `to_tsvector('english', normalized_name) @@ plainto_tsquery($${paramIdx++})`,
      );
      params.push(q);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM products ${where}`,
      params,
    );

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

    res.json({
      zip,
      radius,
      center: { latitude, longitude },
      total: stores.rows.length,
      stores: stores.rows,
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
