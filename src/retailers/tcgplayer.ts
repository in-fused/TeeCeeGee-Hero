/**
 * TCGPlayer scraper — uses their search API endpoint.
 */

import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

interface TCGplayerSearchResult {
  productId: number;
  productName: string;
  imageUrl: string;
  categoryName: string;
  groupName: string;
  lowestPrice: number | null;
  marketPrice: number | null;
  productUrl: string;
}

export class TCGplayerScraper extends BaseRetailerScraper {
  private apiBase = 'https://mpsearch-api.tcgplayer.com/v1';
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

      const resp = await this.client.get<{ results: TCGplayerSearchResult[] }>(
        `${this.apiBase}/search`,
        { params: { productId } },
      );
      const hit = resp.data.results?.[0];
      if (!hit) return { listing: null, success: false, error: 'Product not found' };

      this.requestCount++;
      return {
        listing: this.createListing({
          externalId: String(hit.productId),
          name: hit.productName,
          productUrl: url,
          price: hit.lowestPrice || hit.marketPrice || 0,
          msrp: hit.marketPrice || undefined,
          imageUrl: hit.imageUrl,
          setName: hit.groupName,
          game: this.detectGameFromCategory(hit.categoryName),
          status: hit.lowestPrice ? 'in_stock' : 'out_of_stock',
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
    const { page = 1, limit = 25, inStock } = options;
    const listings: ScrapedListing[] = [];

    try {
      const categoryId = game ? this.getCategoryId(game) : undefined;
      const resp = await this.client.get<{
        results: TCGplayerSearchResult[];
        totalResults: number;
      }>(`${this.apiBase}/search`, {
        params: {
          q: query,
          categoryId,
          page: page - 1,
          pageSize: limit,
          sortOrder: 'price_asc',
        },
      });

      if (!resp.data.results) return listings;

      for (const r of resp.data.results) {
        if (inStock && !r.lowestPrice) continue;
        listings.push(
          this.createListing({
            externalId: String(r.productId),
            name: r.productName,
            productUrl: r.productUrl || `${this.productBase}/${r.productId}`,
            price: r.lowestPrice || r.marketPrice || 0,
            msrp: r.marketPrice || undefined,
            imageUrl: r.imageUrl,
            setName: r.groupName,
            game: this.detectGameFromCategory(r.categoryName),
            status: r.lowestPrice ? 'in_stock' : 'out_of_stock',
          }),
        );
      }

      this.requestCount++;
      logger.info({ retailer: 'tcgplayer', query, results: listings.length }, 'TCGplayer search done');
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
      const batch = await this.searchProducts(setName, game, { page, limit: 25 });
      listings.push(...batch);
      hasMore = batch.length === 25;
      page++;
      if (hasMore) await new Promise((r) => setTimeout(r, 1500));
    }
    return listings;
  }

  private extractProductId(url: string): string | null {
    const m = url.match(/\/product\/(\d+)/);
    return m ? m[1] : null;
  }

  private getCategoryId(game: ScraperGameType): number | undefined {
    const map: Record<ScraperGameType, number | undefined> = {
      pokemon: 3,
      one_piece: 81,
      yugioh: 2,
      mtg: 1,
      other: undefined,
    };
    return map[game];
  }

  private detectGameFromCategory(cat: string): ScraperGameType {
    const l = cat.toLowerCase();
    if (l.includes('pokémon') || l.includes('pokemon')) return 'pokemon';
    if (l.includes('one piece')) return 'one_piece';
    if (l.includes('yu-gi-oh') || l.includes('yugioh')) return 'yugioh';
    if (l.includes('magic') || l.includes('mtg')) return 'mtg';
    return 'other';
  }
}

export const tcgplayerScraper = new TCGplayerScraper();
