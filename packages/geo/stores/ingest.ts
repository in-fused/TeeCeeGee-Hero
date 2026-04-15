import axios from 'axios';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// US bounding box — only ingest stores within the continental US
const US_BBOX = '24.396308,-125.0,49.384358,-66.93457';

// Store classification mapping for TCG-relevant retailers
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

// Query for TCG-relevant store types only within US bounds
const overpassQuery = `
[out:json][bbox:${US_BBOX}];
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

interface OsmElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function ingestStores(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Detect PostGIS
    const pgisCheck = await pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'postgis'",
    );
    const usePostGIS = (pgisCheck.rowCount ?? 0) > 0;
    process.stdout.write(`PostGIS: ${usePostGIS ? 'available' : 'not available (using lat/lng only)'}\n`);

    process.stdout.write('Fetching stores from OpenStreetMap (US only)...\n');
    const res = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(overpassQuery)}`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 120_000,
      },
    );

    const elements: OsmElement[] = res.data.elements;
    process.stdout.write(`Received ${elements.length} elements\n`);

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
        const osmId = el.id;
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
        params.push(name, storeType, lat, lon, addr, city, state, zip, osmId);
        paramIdx += 9;
      }

      if (values.length === 0) continue;

      const columns = usePostGIS
        ? 'name, store_type, latitude, longitude, location, address, city, state, zip, osm_id, source'
        : 'name, store_type, latitude, longitude, address, city, state, zip, osm_id, source';

      await pool.query(
        `INSERT INTO stores (${columns})
         VALUES ${values.join(', ')}
         ON CONFLICT (osm_id) DO UPDATE SET
           name = EXCLUDED.name,
           store_type = EXCLUDED.store_type,
           address = EXCLUDED.address,
           retrieved_at = NOW()`,
        params,
      );
      inserted += values.length;
    }

    await pool.query(
      `INSERT INTO connector_health (connector_name, status, last_success_at, updated_at)
       VALUES ('stores_osm', 'healthy', NOW(), NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'healthy', last_success_at = NOW(), last_error = NULL, updated_at = NOW()`,
    );

    process.stdout.write(`Done. Inserted/updated: ${inserted}, Skipped (no name/coords): ${skipped}\n`);
  } catch (err) {
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_failure_at, last_error, updated_at)
       VALUES ('stores_osm', 'failed', NOW(), $1, NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'failed', last_failure_at = NOW(), last_error = $1, updated_at = NOW()`,
        [String(err)],
      )
      .catch(() => {});
    throw err;
  } finally {
    await pool.end();
  }
}

ingestStores().catch((err) => {
  process.stderr.write(`Store ingestion failed: ${err}\n`);
  process.exit(1);
});
