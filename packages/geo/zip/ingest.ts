
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Client } from 'pg';

(async () => {
  const txt = await axios.get('https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.txt');
  const records = parse(txt.data, { columns: true, delimiter: '\t' });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  for (const r of records) {
    await client.query(
      `INSERT INTO zip_centroids (zip, latitude, longitude, source)
       VALUES ($1,$2,$3,'US_CENSUS')
       ON CONFLICT (zip) DO NOTHING`,
      [r.GEOID, r.INTPTLAT, r.INTPTLONG]
    );
  }
  await client.end();
})();
