/**
 * Best Buy Products API integration.
 *
 * Uses the free Best Buy Products API:
 *   GET https://api.bestbuy.com/v1/products(...)
 *
 * Key facts:
 * - Free API key from developer.bestbuy.com (instant)
 * - Category pcmcat1604992984556 = Trading Cards
 * - 5 QPS rate limit
 * - Returns JSON with sku, name, salePrice, onlineAvailability, image, url
 * - No browser automation needed — pure REST
 *
 * Requires BESTBUY_API_KEY env var. Degrades gracefully without it.
 */

import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

/** Best Buy API product shape (fields we request via show=) */
interface BBProduct {
  sku: number;
  name: string;
  salePrice: number;
  regularPrice: number;
  onlineAvailability: boolean;
  inStorePickup: boolean;
  image?: string;
  url: string;
  manufacturer?: string;
  upc?: string;
  categoryPath?: Array<{ id: string; name: string }>;
}

interface BBSearchResponse {
  from: number;
  to: number;
  currentPage: number;
  totalPages: number;
  total: number;
  products: BBProduct[];
}

const BB_API_BASE = 'https://api.bestbuy.com/v1';
const BB_TRADING_CARDS_CATEGORY = 'pcmcat1604992984556';
const BB_SHOW_FIELDS =
  'sku,name,salePrice,regularPrice,onlineAvailability,inStorePickup,image,url,manufacturer,upc';

export class BestBuyScraper extends BaseRetailerScraper {
  private apiKey: string | undefined;

  constructor() {
    super({
      name: 'bestbuy',
      baseUrl: 'https://www.bestbuy.com',
      rateLimitMs: 250, // 5 QPS = 200ms, add margin
      maxRetries: 2,
    });
    this.apiKey = process.env.BESTBUY_API_KEY;
  }

  private ensureApiKey(): void {
    if (!this.apiKey) {
      throw new Error('Best Buy API key not configured (set BESTBUY_API_KEY env var)');
    }
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      this.ensureApiKey();

      // Extract SKU from Best Buy URL: /site/product-name/1234567.p
      const skuMatch = url.match(/\/(\d{7,})\.p/) || url.match(/skuId=(\d+)/);
      if (!skuMatch) {
        return { listing: null, success: false, error: 'Could not extract SKU from Best Buy URL' };
      }

      const sku = skuMatch[1];
      const apiUrl = `${BB_API_BASE}/products/${sku}.json?apiKey=${this.apiKey}&show=${BB_SHOW_FIELDS}`;

      const resp = await this.client.get<BBProduct>(apiUrl, {
        headers: { Accept: 'application/json' },
        referer: false,
      });

      const p = resp.data;
      if (!p || !p.name) {
        return { listing: null, success: false, error: 'Product not found' };
      }

      this.requestCount++;
      return {
        listing: this.productToListing(p),
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
    const { page = 1, limit = 24, inStock } = options;
    this.ensureApiKey();

    // Build Best Buy API query with category filter for trading cards
    const searchFilter = `(search=${encodeURIComponent(query)}&categoryPath.id=${BB_TRADING_CARDS_CATEGORY})`;
    let apiUrl = `${BB_API_BASE}/products${searchFilter}?apiKey=${this.apiKey}&format=json&show=${BB_SHOW_FIELDS}&pageSize=${Math.min(limit, 100)}&page=${page}`;

    if (inStock) {
      // Best Buy API supports filtering on onlineAvailability
      apiUrl = apiUrl.replace(')?', '&onlineAvailability=true)?');
    }

    const resp = await this.client.get<BBSearchResponse>(apiUrl, {
      headers: { Accept: 'application/json' },
      referer: false,
    });

    const products = resp.data?.products;
    if (!Array.isArray(products)) {
      throw new Error('Best Buy API returned unexpected response shape');
    }

    const listings: ScrapedListing[] = [];
    for (const p of products) {
      if (p.salePrice <= 0) continue;

      const detected = this.detectGame(p.name);
      if (game && detected !== game && detected !== 'other') continue;

      listings.push(this.productToListing(p));
    }

    this.requestCount++;
    logger.info(
      { retailer: 'bestbuy', query, results: listings.length, total: resp.data?.total },
      'Best Buy search done',
    );
    return listings;
  }

  private productToListing(p: BBProduct): ScrapedListing {
    return this.createListing({
      externalId: String(p.sku),
      name: p.name,
      productUrl: p.url.startsWith('http') ? p.url : `https://www.bestbuy.com${p.url}`,
      price: p.salePrice || p.regularPrice,
      msrp: p.regularPrice !== p.salePrice ? p.regularPrice : undefined,
      status: p.onlineAvailability ? 'in_stock' : 'out_of_stock',
      imageUrl: p.image,
      game: this.detectGame(p.name),
      condition: 'sealed',
    });
  }
}

export const bestBuyScraper = new BestBuyScraper();
