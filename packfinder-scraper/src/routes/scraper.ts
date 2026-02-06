/**
 * Scraper API Routes
 * Admin endpoints for managing scrapers and ingesting data
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../scraper/logger';
import { setPool } from '../db';
import * as db from '../db';
import {
  getScraper,
  getScraperNames,
  getAllScrapers,
  searchAllRetailers,
  scrapeProductUrl,
  scrapeSetAcrossRetailers,
  getScraperStats,
  resetAllScraperCounts,
} from '../retailers';
import type { GameType } from '../types';

// Admin auth middleware
function requireAdmin(req: Request, res: Response, next: () => void): void {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    res.status(503).json({ error: 'Admin endpoints not configured' });
    return;
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== adminSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

// Create router
export function createScraperRouter(pool: Pool): Router {
  const router = Router();

  // Initialize database pool
  setPool(pool);

  // Apply admin auth to all routes
  router.use(requireAdmin);

  // ============================================================================
  // Scraper Management
  // ============================================================================

  /**
   * GET /scraper/status
   * Get scraper status and stats
   */
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const stats = getScraperStats();
      const dbStats = await db.getScrapingStats();

      res.json({
        success: true,
        data: {
          scrapers: stats,
          database: dbStats,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get scraper status');
      res.status(500).json({
        success: false,
        error: 'Failed to get scraper status',
      });
    }
  });

  /**
   * GET /scraper/retailers
   * List all available retailers
   */
  router.get('/retailers', (_req: Request, res: Response) => {
    const retailers = getScraperNames();
    res.json({
      success: true,
      data: retailers,
    });
  });

  /**
   * POST /scraper/reset
   * Reset all scraper request counts
   */
  router.post('/reset', (_req: Request, res: Response) => {
    resetAllScraperCounts();
    res.json({
      success: true,
      message: 'Scraper counts reset',
    });
  });

  // ============================================================================
  // Search Operations
  // ============================================================================

  /**
   * GET /scraper/search
   * Search products across retailers
   */
  router.get('/search', async (req: Request, res: Response) => {
    const {
      q: query,
      game,
      retailers,
      inStock,
      limit = '10',
    } = req.query;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required',
      });
      return;
    }

    try {
      const retailerList = retailers
        ? String(retailers).split(',')
        : undefined;

      const { results, errors } = await searchAllRetailers(
        query,
        game as GameType,
        {
          retailers: retailerList,
          inStock: inStock === 'true',
          limit: parseInt(String(limit), 10),
        }
      );

      res.json({
        success: true,
        data: results,
        meta: {
          total: results.length,
          errors: errors.length > 0 ? errors : undefined,
        },
      });
    } catch (error) {
      logger.error({ error, query }, 'Search failed');
      res.status(500).json({
        success: false,
        error: 'Search failed',
      });
    }
  });

  // ============================================================================
  // Product Scraping
  // ============================================================================

  /**
   * POST /scraper/product
   * Scrape a single product URL
   */
  router.post('/product', async (req: Request, res: Response) => {
    const { url, retailer } = req.body;

    if (!url) {
      res.status(400).json({
        success: false,
        error: 'URL is required',
      });
      return;
    }

    try {
      const result = await scrapeProductUrl(url, retailer);

      if (result.listing) {
        // Save to database
        const listingId = await db.upsertListing(result.listing);

        res.json({
          success: true,
          data: {
            ...result.listing,
            id: listingId,
          },
        });
      } else {
        res.status(404).json({
          success: false,
          error: result.error || 'Product not found',
        });
      }
    } catch (error) {
      logger.error({ error, url }, 'Product scrape failed');
      res.status(500).json({
        success: false,
        error: 'Product scrape failed',
      });
    }
  });

  /**
   * POST /scraper/set
   * Scrape all products for a set
   */
  router.post('/set', async (req: Request, res: Response) => {
    const { setName, game, retailers } = req.body;

    if (!setName || !game) {
      res.status(400).json({
        success: false,
        error: 'setName and game are required',
      });
      return;
    }

    // Create a scraping job
    const jobId = await db.createScrapingJob(
      `Scrape set: ${setName}`,
      retailers?.join(','),
      game
    );

    // Start scraping in background
    db.startScrapingJob(jobId).catch(() => {});

    // Scrape asynchronously
    scrapeSetAcrossRetailers(setName, game as GameType, { retailers })
      .then(async ({ results, errors }) => {
        let newListings = 0;
        let updatedListings = 0;

        for (const listing of results) {
          try {
            const existing = await db.getListingByExternalId(
              listing.retailer,
              listing.externalId
            );
            await db.upsertListing(listing);

            if (existing) {
              updatedListings++;
            } else {
              newListings++;
            }
          } catch (err) {
            logger.error({ err, listing }, 'Failed to save listing');
          }
        }

        await db.updateScrapingJobProgress(jobId, {
          processedUrls: results.length,
          successfulScrapes: results.length,
          failedScrapes: errors.length,
          newListings,
          updatedListings,
        });

        await db.completeScrapingJob(
          jobId,
          errors.length === 0,
          errors.map(e => ({ url: e.retailer, error: e.error }))
        );
      })
      .catch(async (error) => {
        logger.error({ error }, 'Set scrape failed');
        await db.completeScrapingJob(jobId, false, [
          { url: 'set', error: error.message },
        ]);
      });

    // Return job ID immediately
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Scraping job started',
      },
    });
  });

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * POST /scraper/bulk
   * Scrape multiple product URLs
   */
  router.post('/bulk', async (req: Request, res: Response) => {
    const { urls, retailer } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({
        success: false,
        error: 'urls array is required',
      });
      return;
    }

    // Create a scraping job
    const jobId = await db.createScrapingJob(
      `Bulk scrape: ${urls.length} URLs`,
      retailer
    );

    // Start scraping in background
    const scraper = retailer ? getScraper(retailer) : null;

    if (!scraper && retailer) {
      res.status(400).json({
        success: false,
        error: `Unknown retailer: ${retailer}`,
      });
      return;
    }

    db.startScrapingJob(jobId).catch(() => {});

    // Process URLs
    const processUrls = async () => {
      let processed = 0;
      let successful = 0;
      let failed = 0;
      let newListings = 0;
      let updatedListings = 0;
      const errors: Array<{ url: string; error: string }> = [];

      for (const url of urls) {
        try {
          let result;
          if (scraper) {
            result = await scraper.scrapeProduct(url);
          } else {
            const scrapeResult = await scrapeProductUrl(url);
            result = {
              listing: scrapeResult.listing,
              success: !!scrapeResult.listing,
              error: scrapeResult.error,
            };
          }

          processed++;

          if (result.listing) {
            successful++;
            const existing = await db.getListingByExternalId(
              result.listing.retailer,
              result.listing.externalId
            );
            await db.upsertListing(result.listing);

            if (existing) {
              updatedListings++;
            } else {
              newListings++;
            }
          } else {
            failed++;
            errors.push({ url, error: result.error || 'Unknown error' });
          }

          // Update progress every 10 items
          if (processed % 10 === 0) {
            await db.updateScrapingJobProgress(jobId, {
              processedUrls: processed,
              successfulScrapes: successful,
              failedScrapes: failed,
              newListings,
              updatedListings,
            });
          }
        } catch (error) {
          failed++;
          errors.push({
            url,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      await db.updateScrapingJobProgress(jobId, {
        processedUrls: processed,
        successfulScrapes: successful,
        failedScrapes: failed,
        newListings,
        updatedListings,
      });

      await db.completeScrapingJob(jobId, failed === 0, errors);
    };

    // Start processing in background
    processUrls().catch(async (error) => {
      logger.error({ error }, 'Bulk scrape failed');
      await db.completeScrapingJob(jobId, false, [
        { url: 'bulk', error: error.message },
      ]);
    });

    res.json({
      success: true,
      data: {
        jobId,
        totalUrls: urls.length,
        message: 'Bulk scraping job started',
      },
    });
  });

  // ============================================================================
  // Listings Management
  // ============================================================================

  /**
   * GET /scraper/listings
   * Get scraped listings with filters
   */
  router.get('/listings', async (req: Request, res: Response) => {
    const {
      game,
      retailer,
      productType,
      setName,
      status,
      minPrice,
      maxPrice,
      inStock,
      search,
      limit = '50',
      offset = '0',
    } = req.query;

    try {
      const { listings, total } = await db.getListings({
        game: game as string,
        retailer: retailer as string,
        productType: productType as string,
        setName: setName as string,
        status: status as string,
        minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
        inStock: inStock === 'true',
        search: search as string,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      });

      res.json({
        success: true,
        data: listings,
        meta: {
          total,
          page: Math.floor(parseInt(offset as string, 10) / parseInt(limit as string, 10)) + 1,
          limit: parseInt(limit as string, 10),
          hasMore: listings.length === parseInt(limit as string, 10),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get listings');
      res.status(500).json({
        success: false,
        error: 'Failed to get listings',
      });
    }
  });

  /**
   * GET /scraper/listings/:id
   * Get a specific listing
   */
  router.get('/listings/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const listing = await db.getListingById(id);

      if (!listing) {
        res.status(404).json({
          success: false,
          error: 'Listing not found',
        });
        return;
      }

      // Get price history
      const priceHistory = await db.getPriceHistory(id, 30);

      res.json({
        success: true,
        data: {
          ...listing,
          priceHistory,
        },
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to get listing');
      res.status(500).json({
        success: false,
        error: 'Failed to get listing',
      });
    }
  });

  /**
   * POST /scraper/listings/:id/refresh
   * Refresh a listing by re-scraping
   */
  router.post('/listings/:id/refresh', async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const listing = await db.getListingById(id);

      if (!listing) {
        res.status(404).json({
          success: false,
          error: 'Listing not found',
        });
        return;
      }

      const result = await scrapeProductUrl(
        listing.productUrl,
        listing.retailer
      );

      if (result.listing) {
        await db.upsertListing(result.listing);
        res.json({
          success: true,
          data: result.listing,
        });
      } else {
        res.status(404).json({
          success: false,
          error: result.error || 'Failed to refresh listing',
        });
      }
    } catch (error) {
      logger.error({ error, id }, 'Failed to refresh listing');
      res.status(500).json({
        success: false,
        error: 'Failed to refresh listing',
      });
    }
  });

  // ============================================================================
  // Changes & Alerts
  // ============================================================================

  /**
   * GET /scraper/changes
   * Get recent inventory changes
   */
  router.get('/changes', async (req: Request, res: Response) => {
    const { type, retailer, limit = '50' } = req.query;

    try {
      const changes = await db.getRecentChanges({
        changeType: type as string,
        retailer: retailer as string,
        limit: parseInt(limit as string, 10),
      });

      res.json({
        success: true,
        data: changes,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get changes');
      res.status(500).json({
        success: false,
        error: 'Failed to get changes',
      });
    }
  });

  // ============================================================================
  // Jobs
  // ============================================================================

  /**
   * GET /scraper/jobs
   * Get scraping jobs
   */
  router.get('/jobs', async (req: Request, res: Response) => {
    const { limit = '10' } = req.query;

    try {
      const jobs = await db.getScrapingJobs(parseInt(limit as string, 10));

      res.json({
        success: true,
        data: jobs,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get jobs');
      res.status(500).json({
        success: false,
        error: 'Failed to get jobs',
      });
    }
  });

  /**
   * GET /scraper/jobs/:id
   * Get a specific job
   */
  router.get('/jobs/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    // For now, return from the list
    try {
      const jobs = await db.getScrapingJobs(100);
      const job = jobs.find(j => j.id === id);

      if (!job) {
        res.status(404).json({
          success: false,
          error: 'Job not found',
        });
        return;
      }

      res.json({
        success: true,
        data: job,
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to get job');
      res.status(500).json({
        success: false,
        error: 'Failed to get job',
      });
    }
  });

  return router;
}
