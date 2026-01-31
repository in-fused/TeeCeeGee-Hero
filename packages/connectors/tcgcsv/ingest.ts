
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { Client } from 'pg';

(async () => {
  const csv = await axios.get('https://tcgcsv.com/products.csv');
  const records = parse(csv.data, { columns: true });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  for (const r of records) {
    if (!['Pokemon','One Piece'].includes(r.game)) continue;
    if (!r.category?.toLowerCase().includes('sealed')) continue;
    await client.query(
      `INSERT INTO products (tcgplayer_id,name,category,set_name,game,source)
       VALUES ($1,$2,$3,$4,$5,'TCGCSV')
       ON CONFLICT (tcgplayer_id) DO NOTHING`,
      [r.tcgplayer_id, r.name, r.category, r.set_name, r.game]
    );
  }
  await client.end();
})();
