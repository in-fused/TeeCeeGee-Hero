/**
 * PackFinder Scraper Module
 * 
 * A comprehensive scraping and inventory replenishment system for TCG products.
 * Integrates with the existing PackFinder backend.
 * 
 * Features:
 * - Browser fingerprint spoofing to avoid detection
 * - Multi-retailer scraping (TCGplayer, Amazon, eBay, Walmart, etc.)
 * - Real-time price and inventory tracking
 * - Automated replenishment recommendations
 * - Purchase order management
 */

// Export scraper components
export {
  ScraperClient,
  createScraper,
  batchScrape,
  ScraperError,
  type ScrapedResponse,
} from './scraper/client';

// Export fingerprint utilities
export {
  generateFingerprint,
  fingerprintToHeaders,
  fingerprintRotator,
  FingerprintRotator,
  getRandomDelay,
  getMouseMovementDelay,
  generateReferer,
  type BrowserFingerprint,
  type RequestConfig,
} from './scraper/fingerprint';

// Export retailer scrapers
export {
  BaseRetailerScraper,
  TCGplayerScraper,
  tcgplayerScraper,
  GenericRetailerScraper,
  createAmazonScraper,
  createEbayScraper,
  createWalmartScraper,
  createTargetScraper,
  createGameStopScraper,
  createBestBuyScraper,
  createCollectorsCacheScraper,
  createTrollAndToadScraper,
} from './retailers';

// Export retailer registry functions
export {
  initializeScrapers,
  getScraper,
  getScraperNames,
  getAllScrapers,
  searchAllRetailers,
  scrapeProductUrl,
  scrapeSetAcrossRetailers,
  getScraperStats,
  resetAllScraperCounts,
} from './retailers';

// Export database functions
export {
  setPool,
  getPool,
  upsertListing,
  getListingById,
  getListingByExternalId,
  getListings,
  markListingsInactive,
  getPriceHistory,
  getLowestPrice,
  getRecentChanges,
  markChangesNotified,
  createReplenishmentNeed,
  getReplenishmentNeeds,
  resolveReplenishmentNeed,
  createScrapingJob,
  startScrapingJob,
  updateScrapingJobProgress,
  completeScrapingJob,
  getScrapingJobs,
  getScrapingStats,
  healthCheck,
} from './db';

// Export API routes
export { createScraperRouter } from './routes/scraper';
export { createReplenishmentRouter } from './routes/replenishment';

// Export types
export type {
  GameType,
  ProductType,
  Condition,
  ListingStatus,
  ScrapedListing,
  InventorySnapshot,
  InventoryChange,
  PricePoint,
  PriceAlert,
  ReplenishmentNeed,
  PurchaseOrder,
  ScrapingJob,
  WebhookEventType,
  WebhookPayload,
  RetailerConfig,
  ApiResponse,
  PaginatedResponse,
} from './types';

// Version
export const VERSION = '1.0.0';

/**
 * Initialize the scraper module
 * Must be called with the Postgres pool before using any database functions
 */
import { Pool } from 'pg';
import { setPool, initializeScrapers as initRetailers } from './retailer';

export function initialize(pool: Pool): void {
  setPool(pool);
  initRetailers();
}
