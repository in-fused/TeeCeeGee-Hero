
import { Client } from 'pg';
import fs from 'fs';

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const sql = fs.readFileSync('src/db/schema.sql','utf8');
  await client.query(sql);
  await client.end();
})();
