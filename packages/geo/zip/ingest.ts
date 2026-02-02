import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

interface ZipRecord {
  GEOID: string;
  INTPTLAT: string;
  INTPTLONG: string;
}

async function ingestZipCentroids(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Detect PostGIS
    const pgisCheck = await pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'postgis'",
    );
    const usePostGIS = (pgisCheck.rowCount ?? 0) > 0;
    process.stdout.write(`PostGIS: ${usePostGIS ? 'available' : 'not available (using lat/lng only)'}\n`);

    process.stdout.write('Fetching ZIP centroids from US Census Bureau...\n');
    const txt = await axios.get(
      'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.txt',
      { timeout: 60_000 },
    );

    const records: ZipRecord[] = parse(txt.data, { columns: true, delimiter: '\t', trim: true });
    process.stdout.write(`Parsed ${records.length} ZIP centroids\n`);

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
          values.push(
            `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, 'US_CENSUS')`,
          );
        }
        params.push(zip, lat, lon);
        paramIdx += 3;
      }

      if (values.length === 0) continue;

      const columns = usePostGIS
        ? 'zip, latitude, longitude, location, source'
        : 'zip, latitude, longitude, source';

      await pool.query(
        `INSERT INTO zip_centroids (${columns})
         VALUES ${values.join(', ')}
         ON CONFLICT (zip) DO NOTHING`,
        params,
      );
      inserted += values.length;
    }

    await pool.query(
      `INSERT INTO connector_health (connector_name, status, last_success_at, updated_at)
       VALUES ('zip_census', 'healthy', NOW(), NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'healthy', last_success_at = NOW(), last_error = NULL, updated_at = NOW()`,
    );

    process.stdout.write(`Done. Inserted: ${inserted}\n`);
  } catch (err) {
    await pool
      .query(
        `INSERT INTO connector_health (connector_name, status, last_failure_at, last_error, updated_at)
       VALUES ('zip_census', 'failed', NOW(), $1, NOW())
       ON CONFLICT (connector_name) DO UPDATE SET status = 'failed', last_failure_at = NOW(), last_error = $1, updated_at = NOW()`,
        [String(err)],
      )
      .catch(() => {});
    throw err;
  } finally {
    await pool.end();
  }
}

ingestZipCentroids().catch((err) => {
  process.stderr.write(`ZIP ingestion failed: ${err}\n`);
  process.exit(1);
});
