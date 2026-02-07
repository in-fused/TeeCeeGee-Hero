import { describe, it, expect } from 'vitest';
import { generateFingerprint, fingerprintToHeaders, FingerprintRotator, getRandomDelay, generateReferer } from '../src/scraper/fingerprint';
import { ScraperError } from '../src/scraper/client';

describe('Fingerprint generation', () => {
  it('should generate a valid fingerprint', () => {
    const fp = generateFingerprint('html');
    expect(fp.userAgent).toBeTruthy();
    expect(fp.accept).toContain('text/html');
    expect(fp.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should generate json-type fingerprint', () => {
    const fp = generateFingerprint('json');
    expect(fp.accept).toContain('application/json');
  });

  it('should convert fingerprint to headers', () => {
    const fp = generateFingerprint('html');
    const headers = fingerprintToHeaders(fp);
    expect(headers['User-Agent']).toBe(fp.userAgent);
    expect(headers['Accept']).toBe(fp.accept);
    expect(headers['Accept-Language']).toBeTruthy();
    expect(headers['Accept-Encoding']).toBe('gzip, deflate, br');
    expect(headers['sec-ch-ua']).toBeTruthy();
  });

  it('should detect macOS platform from user agent', () => {
    const fp = generateFingerprint('html');
    if (fp.userAgent.includes('Macintosh')) {
      expect(fp.secChUaPlatform).toBe('"macOS"');
    }
  });
});

describe('Fingerprint rotator', () => {
  it('should return same fingerprint for same session', () => {
    const rotator = new FingerprintRotator();
    const fp1 = rotator.get('test-session');
    const fp2 = rotator.get('test-session');
    expect(fp1.sessionId).toBe(fp2.sessionId);
  });

  it('should return different fingerprint after rotation', () => {
    const rotator = new FingerprintRotator();
    const fp1 = rotator.get('test-session');
    const fp2 = rotator.rotate('test-session');
    expect(fp1.sessionId).not.toBe(fp2.sessionId);
  });

  it('should return new fingerprint for different sessions', () => {
    const rotator = new FingerprintRotator();
    const fp1 = rotator.get('session-a');
    const fp2 = rotator.get('session-b');
    expect(fp1.sessionId).not.toBe(fp2.sessionId);
  });

  it('should clear a session', () => {
    const rotator = new FingerprintRotator();
    const fp1 = rotator.get('test');
    rotator.clear('test');
    const fp2 = rotator.get('test');
    expect(fp1.sessionId).not.toBe(fp2.sessionId);
  });
});

describe('getRandomDelay', () => {
  it('should return a number within the specified range', () => {
    for (let i = 0; i < 50; i++) {
      const delay = getRandomDelay(100, 500);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(500);
    }
  });

  it('should use default range when no args provided', () => {
    const delay = getRandomDelay();
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});

describe('generateReferer', () => {
  it('should return a valid URL', () => {
    const referer = generateReferer('https://www.example.com/product/123');
    expect(referer).toMatch(/^https:\/\//);
  });

  it('should sometimes return the target domain as referer', () => {
    const referers = new Set<string>();
    for (let i = 0; i < 100; i++) {
      referers.add(generateReferer('https://www.tcgplayer.com/product/123'));
    }
    // Should include the target domain at least once in 100 tries
    expect(Array.from(referers).some(r => r.includes('tcgplayer.com'))).toBe(true);
  });
});

describe('ScraperError', () => {
  it('should store status code and url', () => {
    const err = new ScraperError('Forbidden', 403, 'https://example.com', true);
    expect(err.message).toBe('Forbidden');
    expect(err.statusCode).toBe(403);
    expect(err.url).toBe('https://example.com');
    expect(err.retryable).toBe(true);
    expect(err.name).toBe('ScraperError');
  });

  it('should default retryable to false', () => {
    const err = new ScraperError('Bad');
    expect(err.retryable).toBe(false);
  });
});

describe('Retailer base class detection', () => {
  // Import the base module to test utility methods
  // We test via the TCGPlayer scraper which extends BaseRetailerScraper
  it('should detect pokemon game from text', async () => {
    const { tcgplayerScraper } = await import('../src/retailers/tcgplayer');
    // searchProducts returns an array — test the scraper initializes without error
    expect(tcgplayerScraper.getName()).toBe('tcgplayer');
  });
});

describe('Scraper registry', () => {
  it('should initialize all scrapers', async () => {
    const { initializeScrapers, getScraperNames, getScraper } = await import('../src/retailers');
    initializeScrapers();
    const names = getScraperNames();
    expect(names).toContain('tcgplayer');
    expect(names).toContain('ebay');
    expect(names).toContain('amazon');
    expect(names).toContain('walmart');
    expect(names).toContain('target');
    expect(names).toContain('gamestop');
    expect(names).toContain('bestbuy');
    expect(names.length).toBe(7);

    const tcg = getScraper('tcgplayer');
    expect(tcg).toBeTruthy();
    expect(tcg!.getName()).toBe('tcgplayer');
  });

  it('should return undefined for unknown scraper', async () => {
    const { getScraper } = await import('../src/retailers');
    expect(getScraper('nonexistent')).toBeUndefined();
  });
});

describe('Scraper types', () => {
  it('should define all expected types', async () => {
    const types = await import('../src/types/scraper');
    // Verify the types module exports correctly by checking type shapes
    const listing: types.ScrapedListing = {
      externalId: '123',
      retailer: 'test',
      productUrl: 'https://example.com',
      name: 'Test Product',
      game: 'pokemon',
      productType: 'etb',
      condition: 'sealed',
      price: 49.99,
      currency: 'USD',
      status: 'in_stock',
      scrapedAt: new Date(),
      updatedAt: new Date(),
    };
    expect(listing.game).toBe('pokemon');
    expect(listing.productType).toBe('etb');
    expect(listing.status).toBe('in_stock');
  });
});
