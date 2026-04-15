import axios from 'axios';
import { Pool } from 'pg';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { parse } from 'csv-parse/sync';

const CENSUS_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip';

export interface ZipIngestResult {
  inserted: number;
}

async function detectPostGIS(pool: Pool): Promise<boolean> {
  try {
    const r = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'postgis'");
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function ingestZip(pool: Pool): Promise<ZipIngestResult> {
  const usePostGIS = await detectPostGIS(pool);

  const zipResponse = await axios.get(CENSUS_URL, {
    timeout: 60_000,
    responseType: 'arraybuffer',
  });

  const tmpDir = mkdtempSync(join(tmpdir(), 'zip-ingest-'));
  try {
    const zipPath = join(tmpDir, 'zcta.zip');
    writeFileSync(zipPath, Buffer.from(zipResponse.data));
    execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`);

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

    return { inserted };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
