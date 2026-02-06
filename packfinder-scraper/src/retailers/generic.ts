/**
 * Generic HTML Scraper for retailers without APIs
 * Uses Cheerio for HTML parsing
 */

import * as cheerio from 'cheerio';
import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../scraper/logger';
import type { ScrapedListing, GameType } from '../types';

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
    cardNumber?: string;
    rarity?: string;
    productGrid?: string;
    productLink?: string;
    nextPage?: string;
  };
  searchUrlTemplate: string;
  productUrlTemplate?: string;
}

/**
 * Generic scraper that can be configured for any retailer
 */
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

  /**
   * Scrape a single product page
   */
  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      const response = await this.client.get<string>(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const $ = cheerio.load(response.data);
      const { selectors } = this.genericConfig;

      // Extract product name
      const name = $(selectors.productName).first().text().trim();
      if (!name) {
        return {
          listing: null,
          success: false,
          error: 'Could not extract product name',
        };
      }

      // Extract price
      const priceText = $(selectors.price).first().text().trim();
      const price = this.parsePrice(priceText);

      // Extract availability
      const availabilityText = $(selectors.availability).first().text().trim();
      const status = this.parseStatus(availabilityText);

      // Extract image
      let imageUrl: string | undefined;
      if (selectors.image) {
        const imgSrc = $(selectors.image).first().attr('src') || 
                      $(selectors.image).first().attr('data-src');
        if (imgSrc) {
          imageUrl = imgSrc.startsWith('http') ? imgSrc : `${this.config.baseUrl}${imgSrc}`;
        }
      }

      // Extract set name
      let setName: string | undefined;
      if (selectors.setName) {
        setName = $(selectors.setName).first().text().trim();
      }

      // Extract external ID from URL
      const externalId = this.extractExternalId(url);

      const game = this.detectGame(name);
      const listing = this.createListing({
        externalId,
        name,
        productUrl: url,
        price,
        status,
        imageUrl,
        setName,
        game,
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
   * Search products using the retailer's search
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
    const { page = 1, limit = 24, inStock } = options;
    const listings: ScrapedListing[] = [];

    try {
      // Build search URL
      const searchUrl = this.genericConfig.searchUrlTemplate
        .replace('{query}', encodeURIComponent(query))
        .replace('{page}', String(page));

      const response = await this.client.get<string>(searchUrl);
      const $ = cheerio.load(response.data);
      const { selectors } = this.genericConfig;

      // Find all product elements
      const productSelector = selectors.productGrid || '.product';
      const products = $(productSelector);

      products.each((_, element) => {
        const $product = $(element);

        // Extract product link
        const linkSelector = selectors.productLink || 'a';
        const link = $product.find(linkSelector).first().attr('href');
        if (!link) return;

        const productUrl = link.startsWith('http') ? link : `${this.config.baseUrl}${link}`;

        // Extract product name
        const name = $product.find(selectors.productName).first().text().trim();
        if (!name) return;

        // Extract price
        const priceText = $product.find(selectors.price).first().text().trim();
        const price = this.parsePrice(priceText);

        // Skip if in-stock filter and no price
        if (inStock && price === 0) return;

        // Extract availability
        const availabilityText = $product.find(selectors.availability).first().text().trim();
        const status = this.parseStatus(availabilityText);

        // Skip if in-stock filter and out of stock
        if (inStock && status === 'out_of_stock') return;

        // Extract image
        let imageUrl: string | undefined;
        if (selectors.image) {
          const img = $product.find(selectors.image).first();
          const imgSrc = img.attr('src') || img.attr('data-src') || img.attr('data-original');
          if (imgSrc) {
            imageUrl = imgSrc.startsWith('http') ? imgSrc : `${this.config.baseUrl}${imgSrc}`;
          }
        }

        // Extract external ID
        const externalId = this.extractExternalId(productUrl);

        const detectedGame = this.detectGame(name);
        // Skip if game filter doesn't match
        if (game && detectedGame !== game && detectedGame !== 'other') return;

        const listing = this.createListing({
          externalId,
          name,
          productUrl,
          price,
          status,
          imageUrl,
          game: detectedGame,
        });

        listings.push(listing);
      });

      this.requestCount++;

      logger.info({
        retailer: this.config.name,
        query,
        results: listings.length,
      }, 'Search completed');

      return listings;
    } catch (error) {
      logger.error({ error, query }, 'Search failed');
      return listings;
    }
  }

  /**
   * Scrape all products for a set (multi-page)
   */
  async scrapeSet(setName: string, game: GameType): Promise<ScrapedListing[]> {
    const listings: ScrapedListing[] = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 10;

    while (hasMore && page <= maxPages) {
      const pageListings = await this.searchProducts(setName, game, {
        page,
        limit: 24,
      });

      listings.push(...pageListings);
      
      // Check if there are more pages
      hasMore = pageListings.length >= 24;
      page++;

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, this.config.rateLimitMs));
      }
    }

    return listings;
  }

  /**
   * Extract external ID from URL
   */
  private extractExternalId(url: string): string {
    // Try to extract product ID from URL
    // Common patterns: /product/12345, /p/12345, ?pid=12345
    const patterns = [
      /\/product\/(\d+)/,
      /\/p\/(\d+)/,
      /[?&]pid=(\d+)/,
      /[?&]id=(\d+)/,
      /-p-(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Fallback: use URL hash
    return Buffer.from(url).toString('base64').substring(0, 16);
  }
}

// ============================================================================
// Pre-configured scrapers for common retailers
// ============================================================================

/**
 * Amazon scraper configuration
 */
export function createAmazonScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'amazon',
    baseUrl: 'https://www.amazon.com',
    rateLimitMs: 2000,
    searchUrlTemplate: 'https://www.amazon.com/s?k={query}&page={page}',
    selectors: {
      productName: '[data-cy="title-recipe-title"] h2 a span, .s-title-instructions-style h2 a span, h2 a span',
      price: '.a-price-whole, .a-price .a-offscreen, .a-price-range .a-offscreen',
      availability: '.a-color-success, .a-color-state, #availability span',
      image: '.s-image, .a-section img',
      productGrid: '[data-component-type="s-search-result"]',
      productLink: 'h2 a',
    },
  });
}

/**
 * eBay scraper configuration
 */
export function createEbayScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'ebay',
    baseUrl: 'https://www.ebay.com',
    rateLimitMs: 1500,
    searchUrlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={query}&_pgn={page}',
    selectors: {
      productName: '.s-item__title span, .s-item__title',
      price: '.s-item__price, .notranslate',
      availability: '.s-item__hotness, .s-item__stockStatus',
      image: '.s-item__image-img',
      productGrid: '.s-item',
      productLink: '.s-item__link',
    },
  });
}

/**
 * Walmart scraper configuration
 */
export function createWalmartScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'walmart',
    baseUrl: 'https://www.walmart.com',
    rateLimitMs: 2000,
    searchUrlTemplate: 'https://www.walmart.com/search?q={query}&page={page}',
    selectors: {
      productName: '[data-automation-id="product-title"]',
      price: '[data-automation-id="product-price"] span, [data-testid="price-current"]',
      availability: '[data-automation-id="product-availability"]',
      image: '[data-testid="product-image"] img',
      productGrid: '[data-testid="item-stack"]',
      productLink: 'a[link-identifier]',
    },
  });
}

/**
 * Target scraper configuration
 */
export function createTargetScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'target',
    baseUrl: 'https://www.target.com',
    rateLimitMs: 2000,
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

/**
 * GameStop scraper configuration
 */
export function createGameStopScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'gamestop',
    baseUrl: 'https://www.gamestop.com',
    rateLimitMs: 1500,
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

/**
 * Best Buy scraper configuration
 */
export function createBestBuyScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'bestbuy',
    baseUrl: 'https://www.bestbuy.com',
    rateLimitMs: 2000,
    searchUrlTemplate: 'https://www.bestbuy.com/site/searchpage.jsp?st={query}&cp={page}',
    selectors: {
      productName: '.sr-item-title-label, .sku-title a',
      price: '.sr-price, .pricing-price__range, .sr-text',
      availability: '.fulfillment-add-to-cart-button, .c-button-disabled',
      image: '.product-image img',
      productGrid: '.sku-item, .sr-item',
      productLink: '.sku-title a, .sr-item-title a',
    },
  });
}

/**
 * Collectors Cache scraper (TCG specialty store)
 */
export function createCollectorsCacheScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'collectors_cache',
    baseUrl: 'https://www.collectorscache.com',
    rateLimitMs: 1500,
    searchUrlTemplate: 'https://www.collectorscache.com/search?q={query}&page={page}',
    selectors: {
      productName: '.product-card__name',
      price: '.product-card__price',
      availability: '.product-card__availability',
      image: '.product-card__image img',
      productGrid: '.product-card',
      productLink: '.product-card__link',
    },
  });
}

/**
 * Troll and Toad scraper (TCG specialty store)
 */
export function createTrollAndToadScraper(): GenericRetailerScraper {
  return new GenericRetailerScraper({
    name: 'troll_and_toad',
    baseUrl: 'https://www.trollandtoad.com',
    rateLimitMs: 1500,
    searchUrlTemplate: 'https://www.trollandtoad.com/search.php?search_query={query}&page={page}',
    selectors: {
      productName: '.product-name a',
      price: '.product-price',
      availability: '.product-availability',
      image: '.product-image img',
      productGrid: '.product',
      productLink: '.product-name a',
    },
  });
}
