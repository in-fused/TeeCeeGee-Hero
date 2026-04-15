/**
 * Card Kingdom sealed product API integration.
 *
 * Uses Card Kingdom's public JSON pricelist:
 *   GET https://api.cardkingdom.com/api/sealed_pricelist
 *
 * Key facts:
 * - MTG ONLY — no Pokemon, One Piece, Yu-Gi-Oh
 * - ~1,800 sealed products with real-time pricing + stock
 * - No auth required, public JSON
 * - Regenerated daily, Cloudflare-cached (5 min TTL)
 * - Fields: id, url, name, edition, ships_internationally, price_retail, qty_retail, price_buy, qty_buying
 */

import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

interface CKSealedItem {
  id: number;
  url: string;
  name: string;
  edition: string;
  ships_internationally: boolean;
  price_retail: number;
  qty_retail: number;
  price_buy: number;
  qty_buying: number;
}

interface CKPricelistResponse {
  meta: { date: string; [key: string]: unknown };
  data: CKSealedItem[];
}

export class CardKingdomScraper extends BaseRetailerScraper {
  private static readonly PRICELIST_URL = 'https://api.cardkingdom.com/api/sealed_pricelist';
  private cachedData: CKSealedItem[] | null = null;
  private cacheTimestamp = 0;
  private static readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  constructor() {
    super({
      name: 'cardkingdom',
      baseUrl: 'https://www.cardkingdom.com',
      rateLimitMs: 2000,
      maxRetries: 2,
    });
  }

  /**
   * Fetch and cache the sealed pricelist.
   * Throws on failure so searchAllRetailers can report the error.
   * Falls back to stale cache if available (better than nothing).
   */
  private async fetchPricelist(): Promise<CKSealedItem[]> {
    const now = Date.now();
    if (this.cachedData && now - this.cacheTimestamp < CardKingdomScraper.CACHE_TTL_MS) {
      return this.cachedData;
    }

    try {
      const resp = await this.client.get<CKPricelistResponse>(
        CardKingdomScraper.PRICELIST_URL,
        { headers: { Accept: 'application/json' }, referer: false },
      );

      const data = resp.data?.data;
      if (!Array.isArray(data)) {
        if (this.cachedData) {
          logger.warn('Card Kingdom pricelist returned unexpected shape — using stale cache');
          return this.cachedData;
        }
        throw new Error('Card Kingdom API returned unexpected response shape');
      }

      this.cachedData = data;
      this.cacheTimestamp = now;
      this.requestCount++;
      logger.info({ count: data.length }, 'Card Kingdom sealed pricelist fetched');
      return data;
    } catch (err) {
      // If we have stale cache, use it but log warning
      if (this.cachedData) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          'Card Kingdom fetch failed — using stale cache',
        );
        return this.cachedData;
      }
      // No cache available — re-throw so the error reaches the frontend
      throw err;
    }
  }

  private itemToListing(item: CKSealedItem): ScrapedListing {
    const productUrl = item.url.startsWith('http')
      ? item.url
      : `https://www.cardkingdom.com${item.url}`;

    return this.createListing({
      externalId: String(item.id),
      name: item.name,
      productUrl,
      price: item.price_retail,
      game: 'mtg' as ScraperGameType,
      setName: item.edition,
      status: item.qty_retail > 0 ? 'in_stock' : 'out_of_stock',
      quantity: item.qty_retail,
      condition: 'sealed',
    });
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      const items = await this.fetchPricelist();
      const match = items.find(
        (item) => url.includes(item.url) || url.includes(String(item.id)),
      );

      if (!match) {
        return { listing: null, success: false, error: 'Product not found in Card Kingdom pricelist' };
      }

      return { listing: this.itemToListing(match), success: true };
    } catch (error) {
      return this.handleError(error, url);
    }
  }

  /**
   * Search the Card Kingdom sealed pricelist.
   * Throws on API failure so the error propagates to the frontend.
   * Returns [] silently only for expected cases (non-MTG game filter, no matches).
   */
  async searchProducts(
    query: string,
    game?: ScraperGameType,
    options: { page?: number; limit?: number; inStock?: boolean } = {},
  ): Promise<ScrapedListing[]> {
    const { limit = 24, inStock } = options;

    // Card Kingdom is MTG-only — skip silently for non-MTG game filters (not an error)
    if (game && game !== 'mtg' && game !== 'other') {
      return [];
    }

    // fetchPricelist throws on failure — let it propagate to searchAllRetailers
    const items = await this.fetchPricelist();
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/);

    const filtered = items.filter((item) => {
      if (inStock && item.qty_retail <= 0) return false;
      if (item.price_retail <= 0) return false;
      const searchText = `${item.name} ${item.edition}`.toLowerCase();
      return queryTerms.every((term) => searchText.includes(term));
    });

    filtered.sort((a, b) => {
      const aExact = a.name.toLowerCase().includes(queryLower) ? 0 : 1;
      const bExact = b.name.toLowerCase().includes(queryLower) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.price_retail - b.price_retail;
    });

    const listings = filtered.slice(0, limit).map((item) => this.itemToListing(item));

    logger.info(
      { retailer: 'cardkingdom', query, results: listings.length, totalMatched: filtered.length },
      'Card Kingdom search done',
    );

    return listings;
  }
}

export const cardKingdomScraper = new CardKingdomScraper();
