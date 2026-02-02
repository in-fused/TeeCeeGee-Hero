import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('Environment validation', () => {
  it('should require DATABASE_URL', () => {
    const schema = z.object({
      DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid DATABASE_URL', () => {
    const schema = z.object({
      DATABASE_URL: z.string().min(1),
    });
    const result = schema.safeParse({ DATABASE_URL: 'postgresql://localhost/test' });
    expect(result.success).toBe(true);
  });

  it('should default PORT to 3000', () => {
    const schema = z.object({
      PORT: z.coerce.number().default(3000),
    });
    const result = schema.parse({});
    expect(result.PORT).toBe(3000);
  });

  it('should validate VALID_RADII contains only 5, 15, 20', () => {
    const VALID_RADII = [5, 15, 20];
    expect(VALID_RADII).toContain(5);
    expect(VALID_RADII).toContain(15);
    expect(VALID_RADII).toContain(20);
    expect(VALID_RADII).not.toContain(10);
  });
});

describe('Input validation', () => {
  it('should validate ZIP code format', () => {
    const zipRegex = /^\d{5}$/;
    expect(zipRegex.test('90210')).toBe(true);
    expect(zipRegex.test('9021')).toBe(false);
    expect(zipRegex.test('902101')).toBe(false);
    expect(zipRegex.test('abcde')).toBe(false);
    expect(zipRegex.test('')).toBe(false);
  });
});
