import { Pool } from 'pg';
import { env } from './env';
import { logger } from './logger';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1');
    return result.rowCount === 1;
  } catch {
    return false;
  }
}

export async function shutdown(): Promise<void> {
  logger.info('Closing database pool');
  await pool.end();
}
