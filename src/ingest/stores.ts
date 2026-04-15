import axios from 'axios';
import { Pool } from 'pg';

const US_BBOX = '24.396308,-125.0,49.384358,-66.93457';
const BIG_BOX_NAMES = ['walmart', 'target', 'costco', "sam's club", 'meijer', 'fred meyer'];
const LGS_SHOP_TYPES = ['toys', 'games', 'anime', 'hobby', 'collector', 'trading_cards'];

export function classifyStore(shopType: string, name: string): string {
  const lower = name.toLowerCase();
  if (BIG_BOX_NAMES.some((b) => lower.includes(b))) return 'big_box';
  if (shopType === 'vending_machine' || lower.includes('vending')) return 'vending';
  if (LGS_SHOP_TYPES.includes(shopType) || lower.includes('card') || lower.includes('comic'))
    return 'lgs';
  return 'unknown';
}

const OVERPASS_QUERY = `
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

interface OsmElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface StoreIngestResult {
  inserted: number;
  skipped: number;
}

async function detectPostGIS(pool: Pool): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'postgis'");
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function ingestStores(pool: Pool): Promise<StoreIngestResult> {
  const usePostGIS = await detectPostGIS(pool);

  const apiRes = await axios.post(
    'https://overpass-api.de/api/interpreter',
    `data=${encodeURIComponent(OVERPASS_QUERY)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 300_000 },
  );

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
        [el.tags?.['addr:housenumber'], el.tags?.['addr:street']].filter(Boolean).join(' ') || null;
      const city = el.tags?.['addr:city'] || null;
      const rawState = el.tags?.['addr:state'] || null;
      const state = rawState && rawState.length <= 2 ? rawState.toUpperCase() : null;
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

  return { inserted, skipped };
}
