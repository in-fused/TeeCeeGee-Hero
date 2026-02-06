/**
 * TCGplayer Scraper
 * Scrapes product data from TCGplayer.com
 */

import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../scraper/logger';
import type { ScrapedListing, GameType } from '../types';

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

interface TCGplayerProductDetails {
  productId: number;
  productName: string;
  imageUrl: string;
  categoryName: string;
  groupName: string;
  description: string;
  lowestPrice: number | null;
  marketPrice: number | null;
  listings: Array<{
    sellerName: string;
    price: number;
    quantity: number;
    condition: string;
  }>;
}

export class TCGplayerScraper extends BaseRetailerScraper {
  private apiBaseUrl = 'https://mpsearch-api.tcgplayer.com/v1';
  private productBaseUrl = 'https://www.tcgplayer.com/product';

  constructor() {
    super({
      name: 'tcgplayer',
      baseUrl: 'https://www.tcgplayer.com',
      rateLimitMs: 1000,
      maxRetries: 3,
    });
  }

  /**
   * Scrape a single product by URL
   */
  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      // Extract product ID from URL
      const productId = this.extractProductId(url);
      if (!productId) {
        return {
          listing: null,
          success: false,
          error: 'Could not extract product ID from URL',
        };
      }

      // Try to get product details from search API first
      const searchResult = await this.searchByProductId(productId);
      if (!searchResult) {
        return {
          listing: null,
          success: false,
          error: 'Product not found',
        };
      }

      const listing = this.createListing({
        externalId: productId,
        name: searchResult.productName,
        productUrl: url,
        price: searchResult.lowestPrice || searchResult.marketPrice || 0,
        imageUrl: searchResult.imageUrl,
        setName: searchResult.groupName,
        game: this.detectGameFromCategory(searchResult.categoryName),
        status: searchResult.lowestPrice ? 'in_stock' : 'out_of_stock',
      });

      this.requestCount++;

      return {
        listing,
        success: true,
      };
    } catch (error) {
      return this.handleError(error, url);
    }
  }

  /**
   * Search products on TCGplayer
   */
  async searchProducts(
    query: string,
    game?: GameType,
    options: {
      page?: number;
      limit?: number;
      inStock?: boolean;
    } = {}
  ): Promise<ScrapedListing[]> {
    const { page = 1, limit = 25, inStock } = options;
    const listings: ScrapedListing[] = [];

    try {
      // Map game to TCGplayer category
      const categoryId = game ? this.getCategoryId(game) : undefined;

      const searchUrl = `${this.apiBaseUrl}/search`;
      const response = await this.client.get<{
        results: TCGplayerSearchResult[];
        totalResults: number;
      }>(searchUrl, {
        params: {
          q: query,
          categoryId,
          page: page - 1, // TCGplayer uses 0-based pagination
          pageSize: limit,
          // Sort by price ascending
          sortOrder: 'price_asc',
        },
      });

      if (!response.data.results) {
        return listings;
      }

      for (const result of response.data.results) {
        // Skip if only in-stock requested and no price available
        if (inStock && !result.lowestPrice) {
          continue;
        }

        const listing = this.createListing({
          externalId: String(result.productId),
          name: result.productName,
          productUrl: result.productUrl || `${this.productBaseUrl}/${result.productId}`,
          price: result.lowestPrice || result.marketPrice || 0,
          msrp: result.marketPrice || undefined,
          imageUrl: result.imageUrl,
          setName: result.groupName,
          game: this.detectGameFromCategory(result.categoryName),
          status: result.lowestPrice ? 'in_stock' : 'out_of_stock',
        });

        listings.push(listing);
      }

      this.requestCount++;

      logger.info({
        retailer: this.config.name,
        query,
        results: listings.length,
      }, 'TCGplayer search completed');

      return listings;
    } catch (error) {
      logger.error({ error, query }, 'TCGplayer search failed');
      return listings;
    }
  }

  /**
   * Scrape all products for a specific set
   */
  async scrapeSet(setName: string, game: GameType): Promise<ScrapedListing[]> {
    const listings: ScrapedListing[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) { // Limit to 10 pages to avoid excessive requests
      const pageListings = await this.searchProducts(setName, game, {
        page,
        limit: 25,
      });

      listings.push(...pageListings);
      hasMore = pageListings.length === 25;
      page++;

      // Add delay between pages
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    return listings;
  }

  /**
   * Get price data for a specific product
   */
  async getPriceData(productId: string): Promise<{
    lowPrice: number | null;
    marketPrice: number | null;
    listings: Array<{
      seller: string;
      price: number;
      quantity: number;
      condition: string;
    }>;
  } | null> {
    try {
      const response = await this.client.get<{
        lowPrice: number | null;
        marketPrice: number | null;
        listings: Array<{
          sellerName: string;
          price: number;
          quantity: number;
          conditionName: string;
        }>;
      }>(`${this.apiBaseUrl}/product/${productId}/prices`);

      return {
        lowPrice: response.data.lowPrice,
        marketPrice: response.data.marketPrice,
        listings: response.data.listings.map(l => ({
          seller: l.sellerName,
          price: l.price,
          quantity: l.quantity,
          condition: l.conditionName,
        })),
      };
    } catch (error) {
      logger.error({ error, productId }, 'Failed to get TCGplayer price data');
      return null;
    }
  }

  /**
   * Extract product ID from URL
   */
  private extractProductId(url: string): string | null {
    // Match patterns like:
    // https://www.tcgplayer.com/product/12345/pokemon-card-name
    // https://www.tcgplayer.com/product/12345
    const match = url.match(/\/product\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Search for a specific product by ID
   */
  private async searchByProductId(productId: string): Promise<TCGplayerSearchResult | null> {
    try {
      const response = await this.client.get<{
        results: TCGplayerSearchResult[];
      }>(`${this.apiBaseUrl}/search`, {
        params: {
          productId,
        },
      });

      return response.data.results[0] || null;
    } catch (error) {
      logger.error({ error, productId }, 'Failed to search TCGplayer by product ID');
      return null;
    }
  }

  /**
   * Get TCGplayer category ID for a game
   */
  private getCategoryId(game: GameType): number | undefined {
    const categoryIds: Record<GameType, number | undefined> = {
      pokemon: 3, // Pokémon
      one_piece: 81, // One Piece (may need verification)
      yugioh: 2, // Yu-Gi-Oh!
      mtg: 1, // Magic: The Gathering
      other: undefined,
    };
    return categoryIds[game];
  }

  /**
   * Detect game from TCGplayer category name
   */
  private detectGameFromCategory(categoryName: string): GameType {
    const lower = categoryName.toLowerCase();
    
    if (lower.includes('pokémon') || lower.includes('pokemon')) {
      return 'pokemon';
    }
    if (lower.includes('one piece')) {
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
   * Get trending products
   */
  async getTrendingProducts(game?: GameType, limit: number = 25): Promise<ScrapedListing[]> {
    try {
      const categoryId = game ? this.getCategoryId(game) : undefined;
      
      const response = await this.client.get<{
        results: TCGplayerSearchResult[];
      }>(`${this.apiBaseUrl}/trending`, {
        params: {
          categoryId,
          pageSize: limit,
        },
      });

      return response.data.results.map(result =>
        this.createListing({
          externalId: String(result.productId),
          name: result.productName,
          productUrl: result.productUrl || `${this.productBaseUrl}/${result.productId}`,
          price: result.lowestPrice || result.marketPrice || 0,
          msrp: result.marketPrice || undefined,
          imageUrl: result.imageUrl,
          setName: result.groupName,
          game: this.detectGameFromCategory(result.categoryName),
          status: result.lowestPrice ? 'in_stock' : 'out_of_stock',
        })
      );
    } catch (error) {
      logger.error({ error, game }, 'Failed to get TCGplayer trending products');
      return [];
    }
  }
}

// Export singleton instance
export const tcgplayerScraper = new TCGplayerScraper();
