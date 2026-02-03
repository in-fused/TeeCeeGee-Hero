import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { env } from '../lib/env';
import { pool, hasPostGIS } from '../lib/db';
import { logger } from '../lib/logger';

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

// POST /admin/ingest/zip
router.post('/ingest/zip', async (_req: Request, res: Response) => {
  try {
    const usePostGIS = await hasPostGIS();

    // Download and extract ZIP archive from Census Bureau
    const zipResponse = await axios.get(
      'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip',
      { timeout: 60_000, responseType: 'arraybuffer' },
    );

    const tmpDir = mkdtempSync(join(tmpdir(), 'zip-ingest-'));
    try {
      const zipPath = join(tmpDir, 'zcta.zip');
      writeFileSync(zipPath, Buffer.from(zipResponse.data));
      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`);

      // Find the extracted .txt file
      const extractedFile = execSync(`ls "${tmpDir}"/*.txt`).toString().trim().split('\n')[0];
      const txtData = readFileSync(extractedFile, 'utf-8');

      interface ZipRecord {
        GEOID: string;
        INTPTLAT: string;
        INTPTLONG: string;
      }
      const records: ZipRecord[] = parse(txtData, { columns: true, delimiter: '\t', trim: true });

      const BATCH_SIZE = 500;
      let inserted = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const values: string[] = [];
        const params: (string | number)[] = [];
        let paramIdx = 1;

        for (const r of batch) {
          const zip = (r.GEOID || '').trim();
          const lat = parseFloat(r.INTPTLAT);
          const lon = parseFloat(r.INTPTLONG);
          if (!zip || zip.length !== 5 || isNaN(lat) || isNaN(lon)) continue;

          if (usePostGIS) {
            values.push(
              `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, ST_SetSRID(ST_MakePoint($${paramIdx + 2}, $${paramIdx + 1}), 4326)::geography, 'US_CENSUS')`,
            );
          } else {
            values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, 'US_CENSUS')`);
          }
          params.push(zip, lat, lon);
          paramIdx += 3;
        }

        if (values.length === 0) continue;

        const columns = usePostGIS
          ? 'zip, latitude, longitude, location, source'
          : 'zip, latitude, longitude, source';

        await pool.query(
          `INSERT INTO zip_centroids (${columns}) VALUES ${values.join(', ')} ON CONFLICT (zip) DO NOTHING`,
          params,
        );
        inserted += values.length;
      }

      await pool.query(
        `INSERT INTO connector_health (connector_name, status, last_success_at, updated_at)
       VALUES ('zip_census', 'healthy', NOW(), NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'healthy', last_success_at = NOW(), last_error = NULL, updated_at = NOW()`,
      );

      logger.info({ inserted }, 'ZIP ingest complete');
      res.json({ status: 'OK', inserted });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err) {
    logger.error({ err }, 'ZIP ingest failed');
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_failure_at, last_error, updated_at)
       VALUES ('zip_census', 'failed', NOW(), $1, NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'failed', last_failure_at = NOW(), last_error = $1, updated_at = NOW()`,
        [String(err)],
      )
      .catch(() => {});
    res.status(500).json({ status: 'ERROR', message: String(err) });
  }
});

// Store classification helpers
const US_BBOX = '24.396308,-125.0,49.384358,-66.93457';
const BIG_BOX_NAMES = ['walmart', 'target', 'costco', "sam's club", 'meijer', 'fred meyer'];
const LGS_SHOP_TYPES = ['toys', 'games', 'anime', 'hobby', 'collector', 'trading_cards'];

function classifyStore(shopType: string, name: string): string {
  const lower = name.toLowerCase();
  if (BIG_BOX_NAMES.some((b) => lower.includes(b))) return 'big_box';
  if (shopType === 'vending_machine' || lower.includes('vending')) return 'vending';
  if (LGS_SHOP_TYPES.includes(shopType) || lower.includes('card') || lower.includes('comic'))
    return 'lgs';
  return 'unknown';
}

const overpassQuery = `
[out:json][timeout:300][bbox:${US_BBOX}];
(
  node["shop"="toys"];
  node["shop"="games"];
  node["shop"="anime"];
  node["shop"="hobby"];
  node["shop"="collector"];
  node["shop"="trading_cards"];
  node["shop"="department_store"];
  node["shop"="supermarket"]["name"~"Target|Walmart|Meijer",i];
  node["amenity"="vending_machine"]["vending"~"toys|cards"];
  way["shop"="toys"];
  way["shop"="games"];
  way["shop"="anime"];
  way["shop"="hobby"];
  way["shop"="department_store"];
  way["shop"="supermarket"]["name"~"Target|Walmart|Meijer",i];
);
out center;
`;

// POST /admin/ingest/stores
router.post('/ingest/stores', async (_req: Request, res: Response) => {
  try {
    const usePostGIS = await hasPostGIS();

    const apiRes = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(overpassQuery)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 300_000 },
    );

    interface OsmElement {
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }

    const elements: OsmElement[] = apiRes.data.elements;
    let inserted = 0;
    let skipped = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
      const batch = elements.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: (string | number | null)[] = [];
      let paramIdx = 1;

      for (const el of batch) {
        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        if (!lat || !lon) {
          skipped++;
          continue;
        }
        const name = el.tags?.name;
        if (!name) {
          skipped++;
          continue;
        }

        const shopType = el.tags?.shop || el.tags?.amenity || 'unknown';
        const storeType = classifyStore(shopType, name);
        const addr =
          [el.tags?.['addr:housenumber'], el.tags?.['addr:street']].filter(Boolean).join(' ') ||
          null;
        const city = el.tags?.['addr:city'] || null;
        const state = el.tags?.['addr:state'] || null;
        const zip = el.tags?.['addr:postcode']?.substring(0, 5) || null;

        if (usePostGIS) {
          values.push(
            `($${paramIdx}, $${paramIdx + 1}::store_type, $${paramIdx + 2}, $${paramIdx + 3}, ST_SetSRID(ST_MakePoint($${paramIdx + 3}, $${paramIdx + 2}), 4326)::geography, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, 'OPENSTREETMAP')`,
          );
        } else {
          values.push(
            `($${paramIdx}, $${paramIdx + 1}::store_type, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, 'OPENSTREETMAP')`,
          );
        }
        params.push(name, storeType, lat, lon, addr, city, state, zip, el.id);
        paramIdx += 9;
      }

      if (values.length === 0) continue;

      const columns = usePostGIS
        ? 'name, store_type, latitude, longitude, location, address, city, state, zip, osm_id, source'
        : 'name, store_type, latitude, longitude, address, city, state, zip, osm_id, source';

      await pool.query(
        `INSERT INTO stores (${columns}) VALUES ${values.join(', ')}
         ON CONFLICT (osm_id) DO UPDATE SET name = EXCLUDED.name, store_type = EXCLUDED.store_type, address = EXCLUDED.address, retrieved_at = NOW()`,
        params,
      );
      inserted += values.length;
    }

    await pool.query(
      `INSERT INTO connector_health (connector_name, status, last_success_at, updated_at)
       VALUES ('stores_osm', 'healthy', NOW(), NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'healthy', last_success_at = NOW(), last_error = NULL, updated_at = NOW()`,
    );

    logger.info({ inserted, skipped }, 'Store ingest complete');
    res.json({ status: 'OK', inserted, skipped });
  } catch (err) {
    logger.error({ err }, 'Store ingest failed');
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_failure_at, last_error, updated_at)
       VALUES ('stores_osm', 'failed', NOW(), $1, NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'failed', last_failure_at = NOW(), last_error = $1, updated_at = NOW()`,
        [String(err)],
      )
      .catch(() => {});
    res.status(500).json({ status: 'ERROR', message: String(err) });
  }
});

// TCGCSV helpers
function detectProductType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('elite trainer box') || lower.includes('etb')) return 'etb';
  if (lower.includes('booster box')) return 'booster_box';
  if (lower.includes('booster pack') || lower.includes('sleeved booster')) return 'booster_pack';
  if (lower.includes('blister')) return 'blister';
  if (lower.includes('collection box') || lower.includes('premium collection'))
    return 'collection_box';
  if (lower.includes(' tin ') || lower.endsWith(' tin')) return 'tin';
  if (lower.includes('bundle')) return 'bundle';
  return 'other';
}

function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase();
}

function detectLanguage(name: string, setName: string | null): string {
  const combined = `${name} ${setName || ''}`.toLowerCase();
  if (combined.includes('japanese') || combined.includes('jpn') || combined.includes('japan'))
    return 'JPN';
  return 'ENG';
}

// POST /admin/ingest/tcgcsv
router.post('/ingest/tcgcsv', async (_req: Request, res: Response) => {
  try {
    const csv = await axios.get('https://tcgcsv.com/products.csv', { timeout: 120_000 });

    interface CsvRecord {
      tcgplayer_id: string;
      name: string;
      category: string;
      set_name: string;
      game: string;
    }
    const records: CsvRecord[] = parse(csv.data, { columns: true });

    const filtered = records.filter(
      (r) =>
        ['Pokemon', 'One Piece'].includes(r.game) && r.category?.toLowerCase().includes('sealed'),
    );

    const BATCH_SIZE = 200;
    let inserted = 0;

    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);
      const values: string[] = [];
      const params: (string | number | null)[] = [];
      let paramIdx = 1;

      for (const r of batch) {
        const game = r.game === 'Pokemon' ? 'pokemon' : 'one_piece';
        const productType = detectProductType(r.name);
        const language = detectLanguage(r.name, r.set_name);
        const normalized = normalizeName(r.name);

        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}::game_type, $${paramIdx + 6}::product_type, $${paramIdx + 7}::language_type, 'TCGCSV')`,
        );
        params.push(
          r.tcgplayer_id,
          r.name,
          normalized,
          r.category,
          r.set_name || null,
          game,
          productType,
          language,
        );
        paramIdx += 8;
      }

      if (values.length === 0) continue;

      await pool.query(
        `INSERT INTO products (tcgplayer_id, name, normalized_name, category, set_name, game, product_type, language, source)
         VALUES ${values.join(', ')}
         ON CONFLICT (tcgplayer_id) DO UPDATE SET
           name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name, category = EXCLUDED.category,
           set_name = EXCLUDED.set_name, product_type = EXCLUDED.product_type, language = EXCLUDED.language, retrieved_at = NOW()`,
        params,
      );
      inserted += values.length;
    }

    await pool.query(
      `INSERT INTO connector_health (connector_name, status, last_success_at, updated_at)
       VALUES ('tcgcsv', 'healthy', NOW(), NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'healthy', last_success_at = NOW(), last_error = NULL, updated_at = NOW()`,
    );

    logger.info({ inserted, totalFiltered: filtered.length }, 'TCGCSV ingest complete');
    res.json({ status: 'OK', inserted, totalParsed: records.length, filtered: filtered.length });
  } catch (err) {
    logger.error({ err }, 'TCGCSV ingest failed');
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_failure_at, last_error, updated_at)
       VALUES ('tcgcsv', 'failed', NOW(), $1, NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'failed', last_failure_at = NOW(), last_error = $1, updated_at = NOW()`,
        [String(err)],
      )
      .catch(() => {});
    res.status(500).json({ status: 'ERROR', message: String(err) });
  }
});

// POST /admin/ingest/all — run all three sequentially
router.post('/ingest/all', async (req: Request, res: Response) => {
  const results: Record<string, unknown> = {};

  for (const target of ['zip', 'stores', 'tcgcsv']) {
    try {
      const response = await axios.post(
        `http://localhost:${env.PORT}/admin/ingest/${target}`,
        {},
        { headers: { Authorization: req.headers.authorization || '' }, timeout: 360_000 },
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
