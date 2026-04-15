/**
 * TCGPlayer scraper — uses the real mp-search-api marketplace search endpoint.
 *
 * Endpoint: POST https://mp-search-api.tcgplayer.com/v1/search/request?q=...&isList=false
 * - No auth required
 * - Requires structured JSON body with algorithm, filters, listingSearch
 * - Returns nested results array with productId, productName, marketPrice, lowestPrice, etc.
 */

import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

/** Shape of each product in the search response */
interface TCGPSearchHit {
  productId: number;
  productName: string;
  productLineName: string;
  productLineUrlName: string;
  productUrlName: string;
  setName: string;
  setUrlName: string;
  marketPrice: number | null;
  lowestPrice: number | null;
  lowestPriceWithShipping: number | null;
  totalListings: number;
  customAttributes?: { description?: string; number?: string; rarity?: string };
  shippingCategoryId?: number;
  score?: number;
}

/** Top-level response envelope */
interface TCGPSearchResponse {
  errors: unknown[];
  results: Array<{
    totalResults: number;
    results: TCGPSearchHit[];
  }>;
}

const PRODUCT_LINE_MAP: Record<string, ScraperGameType> = {
  pokemon: 'pokemon',
  'one-piece-card-game': 'one_piece',
  'yugioh': 'yugioh',
  'magic-the-gathering': 'mtg',
};

function productLineForGame(game: ScraperGameType): string[] {
  const map: Partial<Record<ScraperGameType, string>> = {
    pokemon: 'pokemon',
    one_piece: 'one-piece-card-game',
    yugioh: 'yugioh',
    mtg: 'magic-the-gathering',
  };
  const line = map[game];
  return line ? [line] : [];
}

export class TCGplayerScraper extends BaseRetailerScraper {
  /** The REAL working search endpoint (note the dash: mp-search-api) */
  private searchUrl = 'https://mp-search-api.tcgplayer.com/v1/search/request';
  private productBase = 'https://www.tcgplayer.com/product';

  constructor() {
    super({
      name: 'tcgplayer',
      baseUrl: 'https://www.tcgplayer.com',
      rateLimitMs: 1000,
      maxRetries: 3,
    });
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      const productId = this.extractProductId(url);
      if (!productId) {
        return { listing: null, success: false, error: 'Could not extract product ID from URL' };
      }

      // Search for this specific product by name (ID search not supported directly)
      const resp = await this.client.post<TCGPSearchResponse>(
        `${this.searchUrl}?q=${productId}&isList=false`,
        this.buildSearchBody({ from: 0, size: 5 }),
      );
      const hits = resp.data?.results?.[0]?.results;
      const hit = hits?.find((h) => String(h.productId) === productId) || hits?.[0];
      if (!hit) return { listing: null, success: false, error: 'Product not found' };

      this.requestCount++;
      return { listing: this.hitToListing(hit), success: true };
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
    const listings: ScrapedListing[] = [];

    try {
      const from = (page - 1) * limit;
      const productLine = game ? productLineForGame(game) : [];

      const body = this.buildSearchBody({
        from,
        size: limit,
        productLineName: productLine.length ? productLine : undefined,
        sealedOnly: true,
        inStockOnly: inStock,
      });

      const resp = await this.client.post<TCGPSearchResponse>(
        `${this.searchUrl}?q=${encodeURIComponent(query)}&isList=false`,
        body,
      );

      const hits = resp.data?.results?.[0]?.results;
      if (!hits || hits.length === 0) return listings;

      for (const hit of hits) {
        if (inStock && !hit.lowestPrice) continue;
        listings.push(this.hitToListing(hit));
      }

      this.requestCount++;
      logger.info(
        { retailer: 'tcgplayer', query, game, results: listings.length },
        'TCGplayer search done',
      );
      return listings;
    } catch (error) {
      logger.error({ error, query }, 'TCGplayer search failed');
      return listings;
    }
  }

  async scrapeSet(setName: string, game: ScraperGameType): Promise<ScrapedListing[]> {
    const listings: ScrapedListing[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 10) {
      const batch = await this.searchProducts(setName, game, { page, limit: 24 });
      listings.push(...batch);
      hasMore = batch.length === 24;
      page++;
      if (hasMore) await new Promise((r) => setTimeout(r, 1500));
    }
    return listings;
  }

  // -- private helpers --

  private hitToListing(hit: TCGPSearchHit): ScrapedListing {
    // TCGPlayer is a SPA — /product/{id} always resolves correctly
    const productUrl = `${this.productBase}/${hit.productId}`;

    return this.createListing({
      externalId: String(hit.productId),
      name: hit.productName,
      productUrl,
      price: hit.lowestPrice || hit.marketPrice || 0,
      msrp: hit.marketPrice || undefined,
      setName: hit.setName,
      game: this.detectGameFromLine(hit.productLineName),
      status: hit.lowestPrice && hit.totalListings > 0 ? 'in_stock' : 'out_of_stock',
      quantity: hit.totalListings || undefined,
      rarity: hit.customAttributes?.rarity,
      cardNumber: hit.customAttributes?.number,
    });
  }

  private buildSearchBody(opts: {
    from?: number;
    size?: number;
    productLineName?: string[];
    sealedOnly?: boolean;
    inStockOnly?: boolean;
  }) {
    const termFilters: Record<string, unknown> = {};
    if (opts.productLineName?.length) {
      termFilters.productLineName = opts.productLineName;
    }
    if (opts.sealedOnly) {
      termFilters.productTypeName = ['Sealed Products'];
    }

    const listingRange: Record<string, unknown> = {};
    if (opts.inStockOnly) {
      listingRange.quantity = { gte: 1 };
    }

    return {
      algorithm: 'sales_exp_fields_experiment',
      from: opts.from || 0,
      size: opts.size || 24,
      filters: { term: termFilters, range: {}, match: {} },
      listingSearch: {
        filters: {
          term: { sellerStatus: 'Live', channelId: 0 },
          range: listingRange,
          exclude: { channelExclusion: 0 },
        },
      },
      context: { cart: {}, shippingCountry: 'US' },
      settings: { useFuzzySearch: true, didYouMean: {} },
      sort: {},
    };
  }

  private extractProductId(url: string): string | null {
    const m = url.match(/\/product\/(\d+)/);
    return m ? m[1] : null;
  }

  private detectGameFromLine(lineName: string): ScraperGameType {
    const key = lineName.toLowerCase().replace(/\s+/g, '-');
    return PRODUCT_LINE_MAP[key] || this.detectGame(lineName);
  }
}

export const tcgplayerScraper = new TCGplayerScraper();
