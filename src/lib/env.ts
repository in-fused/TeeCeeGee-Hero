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
