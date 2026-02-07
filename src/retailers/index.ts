/**
 * Retailer scraper registry and orchestrator.
 * Manages all scrapers and provides cross-retailer search.
 */

import { BaseRetailerScraper } from './base';
import { TCGplayerScraper, tcgplayerScraper } from './tcgplayer';
import {
  createEbayScraper,
  createAmazonScraper,
  createWalmartScraper,
  createTargetScraper,
  createGameStopScraper,
  createBestBuyScraper,
} from './generic';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

export { BaseRetailerScraper, TCGplayerScraper };

const scraperRegistry = new Map<string, BaseRetailerScraper>();

export function initializeScrapers(): void {
  scraperRegistry.clear();
  scraperRegistry.set('tcgplayer', tcgplayerScraper);
  scraperRegistry.set('ebay', createEbayScraper());
  scraperRegistry.set('amazon', createAmazonScraper());
  scraperRegistry.set('walmart', createWalmartScraper());
  scraperRegistry.set('target', createTargetScraper());
  scraperRegistry.set('gamestop', createGameStopScraper());
  scraperRegistry.set('bestbuy', createBestBuyScraper());
  logger.info({ scrapers: Array.from(scraperRegistry.keys()) }, 'Scraper registry initialized');
}

export function getScraper(name: string): BaseRetailerScraper | undefined {
  return scraperRegistry.get(name);
}

export function getScraperNames(): string[] {
  return Array.from(scraperRegistry.keys());
}

export function getAllScrapers(): BaseRetailerScraper[] {
  return Array.from(scraperRegistry.values());
}

export async function searchAllRetailers(
  query: string,
  game?: ScraperGameType,
  options: { retailers?: string[]; inStock?: boolean; limit?: number } = {},
): Promise<{ results: ScrapedListing[]; errors: Array<{ retailer: string; error: string }> }> {
  const { retailers, inStock, limit = 10 } = options;
  const scrapers = retailers
    ? (retailers.map((n) => scraperRegistry.get(n)).filter(Boolean) as BaseRetailerScraper[])
    : getAllScrapers();

  const results: ScrapedListing[] = [];
  const errors: Array<{ retailer: string; error: string }> = [];

  await Promise.all(
    scrapers.map(async (s) => {
      try {
        const listings = await s.searchProducts(query, game, { limit, inStock });
        results.push(...listings);
      } catch (err) {
        errors.push({ retailer: s.getName(), error: err instanceof Error ? err.message : 'Unknown' });
      }
    }),
  );

  results.sort((a, b) => a.price - b.price);
  return { results, errors };
}

export async function scrapeProductUrl(
  url: string,
  retailerHint?: string,
): Promise<{ listing: ScrapedListing | null; retailer: string; error?: string }> {
  let scraper: BaseRetailerScraper | undefined;
  if (retailerHint) {
    scraper = scraperRegistry.get(retailerHint);
  } else {
    const lower = url.toLowerCase();
    for (const [name, s] of scraperRegistry) {
      if (lower.includes(name.replace('_', ''))) {
        scraper = s;
        break;
      }
    }
  }

  if (!scraper) return { listing: null, retailer: 'unknown', error: 'Could not determine retailer' };

  try {
    const result = await scraper.scrapeProduct(url);
    return { listing: result.listing, retailer: scraper.getName(), error: result.error };
  } catch (err) {
    return { listing: null, retailer: scraper.getName(), error: err instanceof Error ? err.message : 'Unknown' };
  }
}

export async function scrapeSetAcrossRetailers(
  setName: string,
  game: ScraperGameType,
  options: { retailers?: string[] } = {},
): Promise<{ results: ScrapedListing[]; errors: Array<{ retailer: string; error: string }> }> {
  const scrapers = options.retailers
    ? (options.retailers.map((n) => scraperRegistry.get(n)).filter(Boolean) as BaseRetailerScraper[])
    : getAllScrapers();

  const results: ScrapedListing[] = [];
  const errors: Array<{ retailer: string; error: string }> = [];

  await Promise.all(
    scrapers.map(async (s) => {
      try {
        const listings = await s.scrapeSet(setName, game);
        results.push(...listings);
      } catch (err) {
        errors.push({ retailer: s.getName(), error: err instanceof Error ? err.message : 'Unknown' });
      }
    }),
  );

  results.sort((a, b) => a.price - b.price);
  return { results, errors };
}

export function getScraperStats(): Array<{ name: string; requestCount: number }> {
  return getAllScrapers().map((s) => ({ name: s.getName(), requestCount: s.getRequestCount() }));
}

export function resetAllScraperCounts(): void {
  getAllScrapers().forEach((s) => s.resetRequestCount());
}

export async function getLowestPrice(
  productName: string,
): Promise<{ price: number; retailer: string; listingId?: string } | null> {
  // This is a DB-backed version that searches scraped_listings
  // Used by replenishment routes. Actual implementation in db/scraper.ts
  return null;
}
