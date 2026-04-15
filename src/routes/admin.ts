import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { env } from '../lib/env';
import { pool } from '../lib/db';
import { logger } from '../lib/logger';
import { ingestZip } from '../ingest/zip';
import { ingestStores } from '../ingest/stores';
import { ingestTcgcsv } from '../ingest/tcgcsv';
import { ingestPrices } from '../ingest/prices';
import { PokemonTCGConnector } from '../connectors/pokemon-tcg';
import { OnePieceTCGConnector } from '../connectors/onepiece-tcg';

const router = Router();

// Auth middleware — requires ADMIN_SECRET to be set and matched
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_SECRET) {
    res.status(503).json({ error: 'Admin endpoints not configured' });
    return;
  }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

router.use(requireAdmin);

async function updateHealth(name: string, success: boolean, error?: string): Promise<void> {
  if (success) {
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_success_at, updated_at)
       VALUES ($1, 'healthy', NOW(), NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'healthy', last_success_at = NOW(), last_error = NULL, updated_at = NOW()`,
        [name],
      )
      .catch(() => {});
  } else {
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_failure_at, last_error, updated_at)
       VALUES ($1, 'failed', NOW(), $2, NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'failed', last_failure_at = NOW(), last_error = $2, updated_at = NOW()`,
        [name, error || 'Unknown error'],
      )
      .catch(() => {});
  }
}

// POST /admin/ingest/zip
router.post('/ingest/zip', async (_req: Request, res: Response) => {
  try {
    const result = await ingestZip(pool);
    await updateHealth('zip_census', true);
    logger.info(result, 'ZIP ingest complete');
    res.json({ status: 'OK', ...result });
  } catch (err) {
    logger.error({ err }, 'ZIP ingest failed');
    await updateHealth('zip_census', false, String(err));
    res.status(500).json({ status: 'ERROR', message: String(err) });
  }
});

// POST /admin/ingest/stores
router.post('/ingest/stores', async (_req: Request, res: Response) => {
  try {
    const result = await ingestStores(pool);
    await updateHealth('stores_osm', true);
    logger.info(result, 'Store ingest complete');
    res.json({ status: 'OK', ...result });
  } catch (err) {
    logger.error({ err }, 'Store ingest failed');
    await updateHealth('stores_osm', false, String(err));
    res.status(500).json({ status: 'ERROR', message: String(err) });
  }
});

// POST /admin/ingest/tcgcsv
router.post('/ingest/tcgcsv', async (_req: Request, res: Response) => {
  try {
    const result = await ingestTcgcsv(pool);
    await updateHealth('tcgcsv', true);
    logger.info(result, 'TCGCSV ingest complete');
    res.json({ status: 'OK', ...result });
  } catch (err) {
    logger.error({ err }, 'TCGCSV ingest failed');
    await updateHealth('tcgcsv', false, String(err));
    res.status(500).json({ status: 'ERROR', message: String(err) });
  }
});

// POST /admin/ingest/prices — sync market prices from external TCG APIs
router.post('/ingest/prices', async (_req: Request, res: Response) => {
  try {
    const pokemonConnector = new PokemonTCGConnector(
      env.POKEMON_TCG_API_URL,
      env.POKEMON_TCG_API_KEY,
      env.TCGDEX_API_URL,
    );
    const onePieceConnector = new OnePieceTCGConnector(env.ONEPIECE_TCG_API_URL);

    const result = await ingestPrices(pool, pokemonConnector, onePieceConnector);
    await updateHealth('price_sync', true);
    logger.info(result, 'Price sync complete');
    res.json({ status: 'OK', ...result });
  } catch (err) {
    logger.error({ err }, 'Price sync failed');
    await updateHealth('price_sync', false, String(err));
    res.status(500).json({ status: 'ERROR', message: String(err) });
  }
});

// POST /admin/ingest/all — run all four sequentially
router.post('/ingest/all', async (req: Request, res: Response) => {
  const results: Record<string, unknown> = {};

  for (const target of ['zip', 'stores', 'tcgcsv', 'prices']) {
    try {
      const response = await axios.post(
        `http://localhost:${env.PORT}/admin/ingest/${target}`,
        {},
        { headers: { Authorization: req.headers.authorization || '' }, timeout: 600_000 },
      );
      results[target] = response.data;
    } catch (err: unknown) {
      const errData = axios.isAxiosError(err) ? err.response?.data : String(err);
      results[target] = { status: 'ERROR', message: errData };
    }
  }

  res.json({ status: 'OK', results });
});

export { router as adminRouter };
