import axios from 'axios';
import { Pool } from 'pg';
import { detectProductType, normalizeName, detectLanguage, isSealedProduct } from './helpers';

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const CATEGORY_IDS: Record<string, number> = {
  pokemon: 3,
  one_piece: 68,
};

interface TcgGroup {
  groupId: number;
  name: string;
}

interface TcgProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  categoryId: number;
  groupId: number;
  url: string;
}

export interface TcgcsvResult {
  inserted: number;
  groups_scanned: number;
  total_fetched: number;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://tcgcsv.com/',
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await axios.get(url, { timeout: 30_000, headers: BROWSER_HEADERS });
  return res.data;
}

export async function ingestTcgcsv(pool: Pool): Promise<TcgcsvResult> {
  let inserted = 0;
  let groupsScanned = 0;
  let totalFetched = 0;

  for (const [game, categoryId] of Object.entries(CATEGORY_IDS)) {
    const groupData = await fetchJson<{ results: TcgGroup[] }>(
      `${TCGCSV_BASE}/${categoryId}/groups`,
    );
    const groups = groupData.results || [];

    for (const group of groups) {
      groupsScanned++;

      let products: TcgProduct[];
      try {
        const productData = await fetchJson<{ results: TcgProduct[] }>(
          `${TCGCSV_BASE}/${categoryId}/${group.groupId}/products`,
        );
        products = productData.results || [];
      } catch {
        // Some groups return 404 (empty). Skip them.
        continue;
      }

      totalFetched += products.length;

      // Filter to sealed products only
      const sealed = products.filter((p) => isSealedProduct(p.name));
      if (sealed.length === 0) continue;

      const values: string[] = [];
      const params: (string | number | null)[] = [];
      let paramIdx = 1;

      for (const p of sealed) {
        const productType = detectProductType(p.name);
        const language = detectLanguage(p.name, group.name);
        const normalized = normalizeName(p.name);

        values.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}::game_type, $${paramIdx + 6}::product_type, $${paramIdx + 7}::language_type, $${paramIdx + 8}, 'TCGCSV')`,
        );
        params.push(
          String(p.productId),
          p.name,
          normalized,
          `Sealed - ${game}`,
          group.name || null,
          game,
          productType,
          language,
          p.imageUrl || null,
        );
        paramIdx += 9;
      }

      if (values.length === 0) continue;

      await pool.query(
        `INSERT INTO products (tcgplayer_id, name, normalized_name, category, set_name, game, product_type, language, image_url, source)
         VALUES ${values.join(', ')}
         ON CONFLICT (tcgplayer_id) DO UPDATE SET
           name = EXCLUDED.name,
           normalized_name = EXCLUDED.normalized_name,
           category = EXCLUDED.category,
           set_name = EXCLUDED.set_name,
           product_type = EXCLUDED.product_type,
           language = EXCLUDED.language,
           image_url = EXCLUDED.image_url,
           retrieved_at = NOW()`,
        params,
      );
      inserted += sealed.length;
    }
  }

  return { inserted, groups_scanned: groupsScanned, total_fetched: totalFetched };
}
