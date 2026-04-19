import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ADMIN_SECRET: z.string().min(1).optional(),
  // Scrapling proxy (optional — enables stealth browser rendering via Oracle Cloud ARM)
  SCRAPLING_API_URL: z.string().url().optional(),
  SCRAPLING_API_SECRET: z.string().optional(),
  // Retailer API keys (optional — scrapers degrade gracefully without them)
  BESTBUY_API_KEY: z.string().optional(),
  JUSTTCG_API_KEY: z.string().optional(),
  // External TCG API keys (optional — connectors degrade gracefully without them)
  POKEMON_TCG_API_KEY: z.string().optional(),
  ONEPIECE_TCG_API_URL: z.string().url().default('https://optcgapi.com/api'),
  POKEMON_TCG_API_URL: z.string().url().default('https://api.pokemontcg.io/v2'),
  TCGDEX_API_URL: z.string().url().default('https://api.tcgdex.net/v2/en'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.format();
  const message = Object.entries(formatted)
    .filter(([key]) => key !== '_errors')
    .map(([key, val]) => {
      const errors = (val as { _errors: string[] })._errors;
      return `  ${key}: ${errors.join(', ')}`;
    })
    .join('\n');
  throw new Error(`Environment validation failed:\n${message}`);
}

export const env = parsed.data;
