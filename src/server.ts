
import express from 'express';
import { Client } from 'pg';

const app = express();

app.get('/health', (_, res) => res.json({ status: 'OK' }));

app.get('/products/search', async (_, res) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const r = await client.query('SELECT * FROM products');
  await client.end();
  if (!r.rows.length) return res.json({ status: 'NO_DATA_AVAILABLE' });
  res.json(r.rows);
});

app.get('/search', async (req, res) => {
  const zip = req.query.zip as string;
  const radius = Number(req.query.radius || 5);
  if (!zip) return res.status(400).json({ error: 'zip required' });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const z = await client.query('SELECT latitude, longitude FROM zip_centroids WHERE zip=$1',[zip]);
  if (!z.rows.length) {
    await client.end();
    return res.json({ status: 'NO_DATA_AVAILABLE' });
  }

  const { latitude, longitude } = z.rows[0];
  const stores = await client.query(`
    SELECT *,
    (3959 * acos(
      cos(radians($1)) * cos(radians(latitude)) *
      cos(radians(longitude) - radians($2)) +
      sin(radians($1)) * sin(radians(latitude))
    )) AS distance
    FROM stores
    HAVING (3959 * acos(
      cos(radians($1)) * cos(radians(latitude)) *
      cos(radians(longitude) - radians($2)) +
      sin(radians($1)) * sin(radians(latitude))
    )) <= $3
  `,[latitude, longitude, radius]);

  await client.end();
  res.json({ zip, radius, stores: stores.rows });
});

app.listen(3000);
