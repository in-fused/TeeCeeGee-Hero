/**
 * Base scraper class for retailers
 * Provides common functionality for all retailer scrapers
 */

import { ScraperClient, ScrapedResponse, ScraperError } from '../scraper/client';
import { logger } from '../scraper/logger';
import type { ScrapedListing, GameType, ProductType, ListingStatus, Condition } from '../types';

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
  protected requestCount: number = 0;

  constructor(config: RetailerScraperConfig) {
    this.config = config;
    this.client = new ScraperClient({
      baseURL: config.baseUrl,
      rateLimitMs: config.rateLimitMs,
      retries: config.maxRetries,
      sessionKey: config.name,
    });
  }

  /**
   * Get retailer name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Scrape a single product URL
   * Must be implemented by subclasses
   */
  abstract scrapeProduct(url: string): Promise<ScrapeResult>;

  /**
   * Search for products
   * Must be implemented by subclasses
   */
  abstract searchProducts(
    query: string,
    game?: GameType,
    options?: {
      page?: number;
      limit?: number;
      inStock?: boolean;
    }
  ): Promise<ScrapedListing[]>;

  /**
   * Get all products for a specific set
   * Optional - can be implemented by subclasses
   */
  async scrapeSet(setName: string, game: GameType): Promise<ScrapedListing[]> {
    // Default implementation uses search
    return this.searchProducts(setName, game, { limit: 100 });
  }

  /**
   * Parse price string to number
   */
  protected parsePrice(priceStr: string): number {
    // Remove currency symbols and whitespace
    const cleaned = priceStr.replace(/[$€£¥,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Detect game from product name/description
   */
  protected detectGame(text: string): GameType {
    const lower = text.toLowerCase();
    
    if (lower.includes('pokémon') || lower.includes('pokemon') || lower.includes('pkm')) {
      return 'pokemon';
    }
    if (lower.includes('one piece') || lower.includes('one-piece') || lower.includes('opcg')) {
      return 'one_piece';
    }
    if (lower.includes('yu-gi-oh') || lower.includes('yugioh')) {
      return 'yugioh';
    }
    if (lower.includes('magic') || lower.includes('mtg')) {
      return 'mtg';
    }
    
    return 'other';
  }

  /**
   * Detect product type from name
   */
  protected detectProductType(name: string): ProductType {
    const lower = name.toLowerCase();
    
    if (lower.includes('booster box') || lower.includes('display')) {
      return 'booster_box';
    }
    if (lower.includes('booster pack') || lower.includes('booster')) {
      return 'booster_pack';
    }
    if (lower.includes('elite trainer box') || lower.includes('etb')) {
      return 'etb';
    }
    if (lower.includes('tin')) {
      return 'tin';
    }
    if (lower.includes('collection box') || lower.includes('premium collection')) {
      return 'collection_box';
    }
    if (lower.includes('bundle')) {
      return 'bundle';
    }
    if (lower.includes('single') || lower.match(/\d+\/\d+/)) {
      return 'single';
    }
    
    return 'other';
  }

  /**
   * Parse availability status
   */
  protected parseStatus(statusText: string): ListingStatus {
    const lower = statusText.toLowerCase();
    
    if (lower.includes('in stock') || lower.includes('available')) {
      return 'in_stock';
    }
    if (lower.includes('out of stock') || lower.includes('unavailable') || lower.includes('sold out')) {
      return 'out_of_stock';
    }
    if (lower.includes('pre-order') || lower.includes('preorder')) {
      return 'preorder';
    }
    if (lower.includes('backorder')) {
      return 'backorder';
    }
    if (lower.includes('discontinued')) {
      return 'discontinued';
    }
    
    return 'out_of_stock';
  }

  /**
   * Parse condition from text
   */
  protected parseCondition(conditionText: string): Condition {
    const lower = conditionText.toLowerCase();
    
    if (lower.includes('sealed') || lower.includes('new')) {
      return 'sealed';
    }
    if (lower.includes('near mint') || lower.includes('nm')) {
      return 'nm';
    }
    if (lower.includes('lightly played') || lower.includes('lp')) {
      return 'lp';
    }
    if (lower.includes('moderately played') || lower.includes('mp')) {
      return 'mp';
    }
    if (lower.includes('heavily played') || lower.includes('hp')) {
      return 'hp';
    }
    if (lower.includes('damaged')) {
      return 'damaged';
    }
    
    return 'sealed';
  }

  /**
   * Extract set name from product name
   */
  protected extractSetName(name: string, game: GameType): string | undefined {
    // Common set patterns
    const patterns = [
      /-\s*([^-]+)\s*(?:Booster|ETB|Box|Tin)/i,
      /:\s*([^:]+)/,
      /\(([^)]+)\)/,
    ];
    
    for (const pattern of patterns) {
      const match = name.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return undefined;
  }

  /**
   * Handle common scraping errors
   */
  protected handleError(error: unknown, url: string): ScrapeResult {
    if (error instanceof ScraperError) {
      logger.warn({
        retailer: this.config.name,
        url,
        statusCode: error.statusCode,
        retryable: error.retryable,
      }, `Scraper error: ${error.message}`);
      
      return {
        listing: null,
        success: false,
        error: error.message,
      };
    }
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({
      retailer: this.config.name,
      url,
      error: message,
    }, 'Unexpected scraping error');
    
    return {
      listing: null,
      success: false,
      error: message,
    };
  }

  /**
   * Create a standardized listing object
   */
  protected createListing(partial: Partial<ScrapedListing> & { 
    externalId: string;
    name: string;
    price: number;
    productUrl: string;
  }): ScrapedListing {
    const game = partial.game || this.detectGame(partial.name || '');
    
    return {
      externalId: partial.externalId,
      retailer: this.config.name,
      productUrl: partial.productUrl,
      name: partial.name,
      game,
      productType: partial.productType || this.detectProductType(partial.name),
      setName: partial.setName || this.extractSetName(partial.name, game),
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

  /**
   * Get request count
   */
  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Reset request count
   */
  resetRequestCount(): void {
    this.requestCount = 0;
    this.client.resetRequestCount();
  }
}
