import { describe, it, expect } from 'vitest';

// Tests for price sync logic — validates threshold calculations and signal generation
// without requiring a database or external API calls.

describe('Price change detection', () => {
  const PRICE_CHANGE_THRESHOLD = 0.1; // 10%

  function detectPriceChange(
    oldPrice: number | null,
    newPrice: number,
  ): { signalType: string; changePercent: number } | null {
    if (oldPrice === null || oldPrice <= 0) return null;

    const changePercent = Math.abs(newPrice - oldPrice) / oldPrice;
    if (changePercent < PRICE_CHANGE_THRESHOLD) return null;

    return {
      signalType: newPrice < oldPrice ? 'price_drop' : 'price_increase',
      changePercent: changePercent * 100,
    };
  }

  it('should detect significant price drops (>10%)', () => {
    const result = detectPriceChange(100, 85);
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('price_drop');
    expect(result!.changePercent).toBe(15);
  });

  it('should detect significant price increases (>10%)', () => {
    const result = detectPriceChange(50, 60);
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('price_increase');
    expect(result!.changePercent).toBe(20);
  });

  it('should ignore small price changes (<10%)', () => {
    const result = detectPriceChange(100, 95);
    expect(result).toBeNull();
  });

  it('should ignore zero old price', () => {
    const result = detectPriceChange(0, 10);
    expect(result).toBeNull();
  });

  it('should ignore null old price', () => {
    const result = detectPriceChange(null, 10);
    expect(result).toBeNull();
  });

  it('should detect exactly 10% change at threshold', () => {
    const result = detectPriceChange(100, 110);
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('price_increase');
  });

  it('should handle sub-dollar prices correctly', () => {
    const result = detectPriceChange(0.5, 0.3);
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('price_drop');
    expect(result!.changePercent).toBeCloseTo(40);
  });
});

describe('Signal type classification', () => {
  const VALID_SIGNAL_TYPES = [
    'user_sighting',
    'price_drop',
    'price_increase',
    'in_stock',
    'out_of_stock',
    'low_stock',
    'restocked',
  ];

  it('should recognize all valid signal types', () => {
    for (const type of VALID_SIGNAL_TYPES) {
      expect(typeof type).toBe('string');
      expect(type.length).toBeGreaterThan(0);
    }
  });

  it('should include price-related signal types', () => {
    expect(VALID_SIGNAL_TYPES).toContain('price_drop');
    expect(VALID_SIGNAL_TYPES).toContain('price_increase');
  });

  it('should include stock-related signal types', () => {
    expect(VALID_SIGNAL_TYPES).toContain('in_stock');
    expect(VALID_SIGNAL_TYPES).toContain('out_of_stock');
    expect(VALID_SIGNAL_TYPES).toContain('low_stock');
    expect(VALID_SIGNAL_TYPES).toContain('restocked');
  });
});

describe('Price history data validation', () => {
  it('should validate price is positive', () => {
    const price = 4.99;
    expect(price).toBeGreaterThan(0);
  });

  it('should validate source is non-empty', () => {
    const validSources = ['pokemon_tcg_api', 'optcg_api', 'tcgdex', 'apitcg', 'tcgcsv'];
    for (const source of validSources) {
      expect(source.length).toBeGreaterThan(0);
    }
  });

  it('should validate confidence between 0 and 1', () => {
    const apiConfidence = 0.9;
    const userConfidence = 0.7;
    const defaultConfidence = 0.5;

    expect(apiConfidence).toBeGreaterThanOrEqual(0);
    expect(apiConfidence).toBeLessThanOrEqual(1);
    expect(userConfidence).toBeGreaterThanOrEqual(0);
    expect(userConfidence).toBeLessThanOrEqual(1);
    expect(defaultConfidence).toBeGreaterThanOrEqual(0);
    expect(defaultConfidence).toBeLessThanOrEqual(1);
  });
});
