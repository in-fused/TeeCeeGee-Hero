/**
 * Base class for all retailer scrapers.
 * Provides shared utilities: price parsing, game/type detection,
 * status parsing, and standardised listing creation.
 */

import { ScraperClient, ScraperError } from '../scraper/client';
import { logger } from '../lib/logger';
import type {
  ScrapedListing,
  ScraperGameType,
  ScraperProductType,
  ListingStatus,
  Condition,
} from '../types/scraper';

export interface RetailerScraperConfig {
  name: string;
  baseUrl: string;
  rateLimitMs: number;
  maxRetries: number;
}

export interface ScrapeResult {
  listing: ScrapedListing | null;
  success: boolean;
  error?: string;
}

export abstract class BaseRetailerScraper {
  protected client: ScraperClient;
  protected config: RetailerScraperConfig;
  protected requestCount = 0;

  constructor(config: RetailerScraperConfig) {
    this.config = config;
    this.client = new ScraperClient({
      baseURL: config.baseUrl,
      rateLimitMs: config.rateLimitMs,
      retries: config.maxRetries,
      sessionKey: config.name,
    });
  }

  getName(): string {
    return this.config.name;
  }

  /** Inject authenticated cookies for this retailer. */
  setAuthCookies(cookieString: string): void {
    this.client.setCookies(cookieString);
  }

  /** Inject extra headers (from Chrome DevTools analysis). */
  setExtraHeaders(headers: Record<string, string>): void {
    this.client.setExtraHeaders(headers);
  }

  abstract scrapeProduct(url: string): Promise<ScrapeResult>;

  abstract searchProducts(
    query: string,
    game?: ScraperGameType,
    options?: { page?: number; limit?: number; inStock?: boolean },
  ): Promise<ScrapedListing[]>;

  async scrapeSet(setName: string, game: ScraperGameType): Promise<ScrapedListing[]> {
    return this.searchProducts(setName, game, { limit: 100 });
  }

  protected parsePrice(priceStr: string): number {
    const cleaned = priceStr.replace(/[$€£¥,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  protected detectGame(text: string): ScraperGameType {
    const l = text.toLowerCase();
    if (l.includes('pokémon') || l.includes('pokemon') || l.includes('pkm')) return 'pokemon';
    if (l.includes('one piece') || l.includes('one-piece') || l.includes('opcg')) return 'one_piece';
    if (l.includes('yu-gi-oh') || l.includes('yugioh')) return 'yugioh';
    if (l.includes('magic') || l.includes('mtg')) return 'mtg';
    return 'other';
  }

  protected detectProductType(name: string): ScraperProductType {
    const l = name.toLowerCase();
    if (l.includes('booster box') || l.includes('display')) return 'booster_box';
    if (l.includes('booster pack') || l.includes('booster')) return 'booster_pack';
    if (l.includes('elite trainer box') || l.includes('etb')) return 'etb';
    if (l.includes('tin')) return 'tin';
    if (l.includes('collection box') || l.includes('premium collection')) return 'collection_box';
    if (l.includes('bundle')) return 'bundle';
    if (l.includes('blister')) return 'blister';
    if (l.includes('single') || /\d+\/\d+/.test(l)) return 'single';
    return 'other';
  }

  protected parseStatus(text: string): ListingStatus {
    const l = text.toLowerCase();
    if (l.includes('in stock') || l.includes('available') || l.includes('add to cart')) return 'in_stock';
    if (l.includes('pre-order') || l.includes('preorder')) return 'preorder';
    if (l.includes('backorder')) return 'backorder';
    if (l.includes('discontinued')) return 'discontinued';
    return 'out_of_stock';
  }

  protected parseCondition(text: string): Condition {
    const l = text.toLowerCase();
    if (l.includes('sealed') || l.includes('new')) return 'sealed';
    if (l.includes('near mint') || l.includes('nm')) return 'nm';
    if (l.includes('lightly played') || l.includes('lp')) return 'lp';
    if (l.includes('moderately played') || l.includes('mp')) return 'mp';
    if (l.includes('heavily played') || l.includes('hp')) return 'hp';
    if (l.includes('damaged')) return 'damaged';
    return 'sealed';
  }

  protected extractSetName(name: string): string | undefined {
    const patterns = [/-\s*([^-]+)\s*(?:Booster|ETB|Box|Tin)/i, /:\s*([^:]+)/, /\(([^)]+)\)/];
    for (const p of patterns) {
      const m = name.match(p);
      if (m) return m[1].trim();
    }
    return undefined;
  }

  protected handleError(error: unknown, url: string): ScrapeResult {
    if (error instanceof ScraperError) {
      logger.warn({ retailer: this.config.name, url, statusCode: error.statusCode }, error.message);
    } else {
      logger.error({ retailer: this.config.name, url, error }, 'Unexpected scraping error');
    }
    return {
      listing: null,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  protected createListing(
    partial: Partial<ScrapedListing> & {
      externalId: string;
      name: string;
      price: number;
      productUrl: string;
    },
  ): ScrapedListing {
    const game = partial.game || this.detectGame(partial.name);
    return {
      externalId: partial.externalId,
      retailer: this.config.name,
      productUrl: partial.productUrl,
      name: partial.name,
      game,
      productType: partial.productType || this.detectProductType(partial.name),
      setName: partial.setName || this.extractSetName(partial.name),
      setCode: partial.setCode,
      cardNumber: partial.cardNumber,
      rarity: partial.rarity,
      condition: partial.condition || 'sealed',
      language: partial.language || 'ENG',
      price: partial.price,
      currency: partial.currency || 'USD',
      msrp: partial.msrp,
      discount: partial.discount,
      status: partial.status || 'out_of_stock',
      quantity: partial.quantity,
      imageUrl: partial.imageUrl,
      scrapedAt: new Date(),
      updatedAt: new Date(),
      rawData: partial.rawData,
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  resetRequestCount(): void {
    this.requestCount = 0;
    this.client.resetRequestCount();
  }
}
