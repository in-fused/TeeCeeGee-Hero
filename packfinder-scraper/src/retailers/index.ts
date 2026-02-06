/**
 * Retailer scraper registry and orchestrator
 */

import { BaseRetailerScraper } from './base';
import { TCGplayerScraper, tcgplayerScraper } from './tcgplayer';
import {
  GenericRetailerScraper,
  createAmazonScraper,
  createEbayScraper,
  createWalmartScraper,
  createTargetScraper,
  createGameStopScraper,
  createBestBuyScraper,
  createCollectorsCacheScraper,
  createTrollAndToadScraper,
} from './generic';
import { logger } from '../scraper/logger';
import type { ScrapedListing, GameType } from '../types';

// Export all scraper classes
export {
  BaseRetailerScraper,
  TCGplayerScraper,
  GenericRetailerScraper,
  createAmazonScraper,
  createEbayScraper,
  createWalmartScraper,
  createTargetScraper,
  createGameStopScraper,
  createBestBuyScraper,
  createCollectorsCacheScraper,
  createTrollAndToadScraper,
};

// Registry of all available scrapers
const scraperRegistry: Map<string, BaseRetailerScraper> = new Map();

/**
 * Initialize all scrapers
 */
export function initializeScrapers(): void {
  // Clear existing
  scraperRegistry.clear();

  // Register TCGplayer (primary source)
  scraperRegistry.set('tcgplayer', tcgplayerScraper);

  // Register generic scrapers
  scraperRegistry.set('amazon', createAmazonScraper());
  scraperRegistry.set('ebay', createEbayScraper());
  scraperRegistry.set('walmart', createWalmartScraper());
  scraperRegistry.set('target', createTargetScraper());
  scraperRegistry.set('gamestop', createGameStopScraper());
  scraperRegistry.set('bestbuy', createBestBuyScraper());
  scraperRegistry.set('collectors_cache', createCollectorsCacheScraper());
  scraperRegistry.set('troll_and_toad', createTrollAndToadScraper());

  logger.info({
    scrapers: Array.from(scraperRegistry.keys()),
  }, 'Scraper registry initialized');
}

/**
 * Get a scraper by name
 */
export function getScraper(name: string): BaseRetailerScraper | undefined {
  return scraperRegistry.get(name);
}

/**
 * Get all registered scraper names
 */
export function getScraperNames(): string[] {
  return Array.from(scraperRegistry.keys());
}

/**
 * Get all scrapers
 */
export function getAllScrapers(): BaseRetailerScraper[] {
  return Array.from(scraperRegistry.values());
}

/**
 * Search across all retailers
 */
export async function searchAllRetailers(
  query: string,
  game?: GameType,
  options: {
    retailers?: string[];
    inStock?: boolean;
    limit?: number;
  } = {}
): Promise<{
  results: ScrapedListing[];
  errors: Array<{ retailer: string; error: string }>;
}> {
  const { retailers, inStock, limit = 10 } = options;
  
  const scrapersToUse = retailers
    ? retailers.map(name => scraperRegistry.get(name)).filter(Boolean) as BaseRetailerScraper[]
    : getAllScrapers();

  const results: ScrapedListing[] = [];
  const errors: Array<{ retailer: string; error: string }> = [];

  // Search all scrapers in parallel
  const searchPromises = scrapersToUse.map(async (scraper) => {
    try {
      const listings = await scraper.searchProducts(query, game, {
        limit,
        inStock,
      });
      results.push(...listings);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ retailer: scraper.getName(), error: message });
    }
  });

  await Promise.all(searchPromises);

  // Sort by price
  results.sort((a, b) => a.price - b.price);

  return { results, errors };
}

/**
 * Scrape a specific product URL
 */
export async function scrapeProductUrl(
  url: string,
  retailerHint?: string
): Promise<{
  listing: ScrapedListing | null;
  retailer: string;
  error?: string;
}> {
  // Try to detect retailer from URL
  let scraper: BaseRetailerScraper | undefined;

  if (retailerHint) {
    scraper = scraperRegistry.get(retailerHint);
  } else {
    // Auto-detect from URL
    const lowerUrl = url.toLowerCase();
    for (const [name, s] of scraperRegistry) {
      if (lowerUrl.includes(name.replace('_', ''))) {
        scraper = s;
        break;
      }
    }
  }

  if (!scraper) {
    return {
      listing: null,
      retailer: 'unknown',
      error: 'Could not determine retailer from URL',
    };
  }

  try {
    const result = await scraper.scrapeProduct(url);
    return {
      listing: result.listing,
      retailer: scraper.getName(),
      error: result.error,
    };
  } catch (error) {
    return {
      listing: null,
      retailer: scraper.getName(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Scrape all products for a set across retailers
 */
export async function scrapeSetAcrossRetailers(
  setName: string,
  game: GameType,
  options: {
    retailers?: string[];
  } = {}
): Promise<{
  results: ScrapedListing[];
  errors: Array<{ retailer: string; error: string }>;
}> {
  const { retailers } = options;
  
  const scrapersToUse = retailers
    ? retailers.map(name => scraperRegistry.get(name)).filter(Boolean) as BaseRetailerScraper[]
    : getAllScrapers();

  const results: ScrapedListing[] = [];
  const errors: Array<{ retailer: string; error: string }> = [];

  // Scrape all retailers in parallel
  const scrapePromises = scrapersToUse.map(async (scraper) => {
    try {
      const listings = await scraper.scrapeSet(setName, game);
      results.push(...listings);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ retailer: scraper.getName(), error: message });
    }
  });

  await Promise.all(scrapePromises);

  // Sort by price
  results.sort((a, b) => a.price - b.price);

  return { results, errors };
}

/**
 * Get scraper stats
 */
export function getScraperStats(): Array<{
  name: string;
  requestCount: number;
}> {
  return getAllScrapers().map(scraper => ({
    name: scraper.getName(),
    requestCount: scraper.getRequestCount(),
  }));
}

/**
 * Reset all scraper request counts
 */
export function resetAllScraperCounts(): void {
  getAllScrapers().forEach(scraper => scraper.resetRequestCount());
}

// Initialize on module load
initializeScrapers();
