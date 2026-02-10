/**
 * Generic HTML scraper for retailers without APIs.
 * Uses Cheerio for HTML parsing — configurable via CSS selectors.
 * Supports Playwright browser rendering for JS-heavy sites.
 */

import * as cheerio from 'cheerio';
import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import { BrowserPool } from '../scraper/browser';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

export interface GenericScraperConfig {
  name: string;
  baseUrl: string;
  rateLimitMs: number;
  selectors: {
    productName: string;
    price: string;
    availability: string;
    image?: string;
    setName?: string;
    productGrid?: string;
    productLink?: string;
  };
  searchUrlTemplate: string;
  /** True for JS-rendered sites that need Playwright — skips HTTP scraping */
  needsBrowser?: boolean;
}

export class GenericRetailerScraper extends BaseRetailerScraper {
  private genericConfig: GenericScraperConfig;

  constructor(config: GenericScraperConfig) {
    super({
      name: config.name,
      baseUrl: config.baseUrl,
      rateLimitMs: config.rateLimitMs,
      maxRetries: 3,
    });
    this.genericConfig = config;
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      let html: string;

      if (this.genericConfig.needsBrowser) {
        const rendered = await this.renderWithBrowser(url);
        if (!rendered) {
          return { listing: null, success: false, error: `${this.config.name} requires browser automation (Playwright unavailable)` };
        }
        html = rendered;
      } else {
        const resp = await this.client.get<string>(url, {
          headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        });
        html = resp.data;
      }

      const $ = cheerio.load(html);
      const { selectors } = this.genericConfig;

      const name = $(selectors.productName).first().text().trim();
      if (!name) return { listing: null, success: false, error: 'Could not extract product name' };

      const price = this.parsePrice($(selectors.price).first().text().trim());
      const status = this.parseStatus($(selectors.availability).first().text().trim());

      let imageUrl: string | undefined;
      if (selectors.image) {
        const src = $(selectors.image).first().attr('src') || $(selectors.image).first().attr('data-src');
        if (src) imageUrl = src.startsWith('http') ? src : `${this.config.baseUrl}${src}`;
      }

      this.requestCount++;
      return {
        listing: this.createListing({
          externalId: this.extractExternalId(url),
          name,
          productUrl: url,
          price,
          status,
          imageUrl,
          game: this.detectGame(name),
        }),
        success: true,
      };
    } catch (error) {
      return this.handleError(error, url);
    }
  }

  async searchProducts(
    query: string,
    game?: ScraperGameType,
    options: { page?: number; limit?: number; inStock?: boolean } = {},
  ): Promise<ScrapedListing[]> {
    const { page = 1, inStock } = options;
    const listings: ScrapedListing[] = [];

    try {
      const searchUrl = this.genericConfig.searchUrlTemplate
        .replace('{query}', encodeURIComponent(query))
        .replace('{page}', String(page));

      let html: string;

      if (this.genericConfig.needsBrowser) {
        const rendered = await this.renderWithBrowser(searchUrl);
        if (!rendered) {
          throw new Error('Requires browser automation (Playwright not available)');
        }
        html = rendered;
      } else {
        const resp = await this.client.get<string>(searchUrl);
        html = resp.data;
      }

      const $ = cheerio.load(html);
      const { selectors } = this.genericConfig;
      const productSelector = selectors.productGrid || '.product';

      $(productSelector).each((_, el) => {
        const $p = $(el);
        const linkSel = selectors.productLink || 'a';
        const link = $p.find(linkSel).first().attr('href');
        if (!link) return;
        const productUrl = link.startsWith('http') ? link : `${this.config.baseUrl}${link}`;

        const name = $p.find(selectors.productName).first().text().trim();
        if (!name) return;

        const price = this.parsePrice($p.find(selectors.price).first().text().trim());
        if (inStock && price === 0) return;

        const status = this.parseStatus($p.find(selectors.availability).first().text().trim());
        if (inStock && status === 'out_of_stock') return;

        let imageUrl: string | undefined;
        if (selectors.image) {
          const img = $p.find(selectors.image).first();
          const src = img.attr('src') || img.attr('data-src') || img.attr('data-original');
          if (src) imageUrl = src.startsWith('http') ? src : `${this.config.baseUrl}${src}`;
        }

        const detected = this.detectGame(name);
        if (game && detected !== game && detected !== 'other') return;

        listings.push(
          this.createListing({
            externalId: this.extractExternalId(productUrl),
            name,
            productUrl,
            price,
            status,
            imageUrl,
            game: detected,
          }),
        );
      });

      this.requestCount++;
      logger.info({ retailer: this.config.name, query, results: listings.length }, 'Search completed');
      return listings;
    } catch (error) {
      logger.error({ error, query, retailer: this.config.name }, 'Search failed');
      return listings;
    }
  }

  async scrapeSet(setName: string, game: ScraperGameType): Promise<ScrapedListing[]> {
    const listings: ScrapedListing[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 10) {
      const batch = await this.searchProducts(setName, game, { page });
      listings.push(...batch);
      hasMore = batch.length >= 24;
      page++;
      if (hasMore) await new Promise((r) => setTimeout(r, this.config.rateLimitMs));
    }
    return listings;
  }

  /**
   * Render a URL using Playwright's headless browser.
   * Returns the fully-rendered HTML or null if Playwright is unavailable.
   */
  private async renderWithBrowser(url: string): Promise<string | null> {
    const pool = BrowserPool.getInstance();
    const { selectors } = this.genericConfig;

    const result = await pool.getRenderedHtml(url, {
      waitSelector: selectors.productGrid,
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
      blockAssets: true,
    });

    if (!result) return null;

    // Detect bot blocks — common patterns across retailers
    const lowerHtml = result.html.toLowerCase();
    if (
      lowerHtml.includes('captcha') ||
      lowerHtml.includes('robot') ||
      lowerHtml.includes('access denied') ||
      lowerHtml.includes('blocked')
    ) {
      logger.warn({ retailer: this.config.name, url }, 'Bot detection triggered during browser render');
    }

    return result.html;
  }

  private extractExternalId(url: string): string {
    const patterns = [/\/product\/(\d+)/, /\/p\/(\d+)/, /[?&]pid=(\d+)/, /[?&]id=(\d+)/, /-p-(\d+)/];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return Buffer.from(url).toString('base64').substring(0, 16);
  }
}

// Pre-configured retailer scrapers
// Note: eBay has a dedicated scraper in ./ebay.ts
// The retailers below use JS rendering — they need Playwright for real data.
// They are registered so users see them in the dashboard, but skip HTTP scraping.

export function createAmazonScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'amazon',
    baseUrl: 'https://www.amazon.com',
    rateLimitMs: 2000,
    needsBrowser: true,
    searchUrlTemplate: 'https://www.amazon.com/s?k={query}&page={page}',
    selectors: {
      productName: 'h2 a span',
      price: '.a-price-whole, .a-price .a-offscreen',
      availability: '.a-color-success, #availability span',
      image: '.s-image',
      productGrid: '[data-component-type="s-search-result"]',
      productLink: 'h2 a',
    },
  });
}

export function createWalmartScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'walmart',
    baseUrl: 'https://www.walmart.com',
    rateLimitMs: 2000,
    needsBrowser: true,
    searchUrlTemplate: 'https://www.walmart.com/search?q={query}&page={page}',
    selectors: {
      productName: '[data-automation-id="product-title"]',
      price: '[data-automation-id="product-price"] span',
      availability: '[data-automation-id="product-availability"]',
      image: '[data-testid="product-image"] img',
      productGrid: '[data-testid="item-stack"]',
      productLink: 'a[link-identifier]',
    },
  });
}

export function createTargetScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'target',
    baseUrl: 'https://www.target.com',
    rateLimitMs: 2000,
    needsBrowser: true,
    searchUrlTemplate: 'https://www.target.com/s?searchTerm={query}&page={page}',
    selectors: {
      productName: '[data-test="product-title"]',
      price: '[data-test="product-price"]',
      availability: '[data-test="availability-status"]',
      image: '[data-test="product-image"] img',
      productGrid: '[data-test="product-card"]',
      productLink: 'a[href*="/p/"]',
    },
  });
}

export function createGameStopScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'gamestop',
    baseUrl: 'https://www.gamestop.com',
    rateLimitMs: 1500,
    needsBrowser: true,
    searchUrlTemplate: 'https://www.gamestop.com/search/?q={query}&page={page}',
    selectors: {
      productName: '.product-tile__title, .product-name',
      price: '.product-tile__price, .sr-price',
      availability: '.product-tile__availability, .availability-msg',
      image: '.product-tile__image img',
      productGrid: '.product-tile',
      productLink: 'a.product-tile__link',
    },
  });
}

export function createBestBuyScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'bestbuy',
    baseUrl: 'https://www.bestbuy.com',
    rateLimitMs: 2000,
    needsBrowser: true,
    searchUrlTemplate: 'https://www.bestbuy.com/site/searchpage.jsp?st={query}&cp={page}',
    selectors: {
      productName: '.sku-title a',
      price: '.pricing-price__range, .sr-text',
      availability: '.fulfillment-add-to-cart-button',
      image: '.product-image img',
      productGrid: '.sku-item, .sr-item',
      productLink: '.sku-title a',
    },
  });
}
