import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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
  return name.replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '').trim().toLowerCase();
}

function detectLanguage(name: string, setName: string | null): string {
  const combined = `${name} ${setName || ''}`.toLowerCase();
  if (combined.includes('japanese') || combined.includes('jpn') || combined.includes('japan'))
    return 'JPN';
  return 'ENG';
}

interface CsvRecord {
  tcgplayer_id: string;
  name: string;
  category: string;
  set_name: string;
  game: string;
}

async function ingestTcgcsv(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    process.stdout.write('Fetching products from TCGCSV...\n');
    const csv = await axios.get('https://tcgcsv.com/products.csv', { timeout: 60_000 });
    const records: CsvRecord[] = parse(csv.data, { columns: true });
    process.stdout.write(`Parsed ${records.length} total products\n`);

    const filtered = records.filter(
      (r) =>
        ['Pokemon', 'One Piece'].includes(r.game) &&
        r.category?.toLowerCase().includes('sealed'),
    );
    process.stdout.write(`Filtered to ${filtered.length} sealed Pokemon/One Piece products\n`);

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
           name = EXCLUDED.name,
           normalized_name = EXCLUDED.normalized_name,
           category = EXCLUDED.category,
           set_name = EXCLUDED.set_name,
           product_type = EXCLUDED.product_type,
           language = EXCLUDED.language,
           retrieved_at = NOW()`,
        params,
      );
      inserted += values.length;
    }

    await pool.query(
      `INSERT INTO connector_health (connector_name, status, last_success_at, updated_at)
       VALUES ('tcgcsv', 'healthy', NOW(), NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'healthy', last_success_at = NOW(), last_error = NULL, updated_at = NOW()`,
    );

    process.stdout.write(`Done. Inserted/updated: ${inserted}\n`);
  } catch (err) {
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_failure_at, last_error, updated_at)
       VALUES ('tcgcsv', 'failed', NOW(), $1, NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'failed', last_failure_at = NOW(), last_error = $1, updated_at = NOW()`,
        [String(err)],
      )
      .catch(() => {});
    throw err;
  } finally {
    await pool.end();
  }
}

ingestTcgcsv().catch((err) => {
  process.stderr.write(`TCGCSV ingestion failed: ${err}\n`);
  process.exit(1);
});
