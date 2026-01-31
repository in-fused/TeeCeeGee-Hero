
import axios from 'axios';
import { Client } from 'pg';

const query = `
[out:json];
(
  node["shop"];
  way["shop"];
);
out center;
`;

(async () => {
  const res = await axios.post('https://overpass-api.de/api/interpreter', query, {
    headers: { 'Content-Type': 'text/plain' }
  });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  for (const el of res.data.elements) {
    const lat = el.lat || el.center?.lat;
    const lon = el.lon || el.center?.lon;
    if (!lat || !lon) continue;

    await client.query(
      `INSERT INTO stores (name, category, latitude, longitude, source)
       VALUES ($1,$2,$3,$4,'OPENSTREETMAP')`,
      [el.tags?.name || 'Unnamed Store', el.tags?.shop || 'unknown', lat, lon]
    );
  }
  await client.end();
})();
