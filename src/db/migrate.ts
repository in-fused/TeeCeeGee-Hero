import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await pool.query('SELECT filename FROM _migrations ORDER BY id');
    const appliedSet = new Set(applied.rows.map((r: { filename: string }) => r.filename));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        process.stdout.write(`Applied: ${file}\n`);
      } catch (err) {
        await client.query('ROLLBACK');
        process.stderr.write(`Failed: ${file}\n`);
        throw err;
      } finally {
        client.release();
      }
    }

    process.stdout.write('Migrations complete.\n');
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  process.stderr.write(`Migration error: ${err}\n`);
  process.exit(1);
});
