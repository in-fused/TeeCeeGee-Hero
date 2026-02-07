/**
 * Scraper API routes — mounted at /admin/scraper.
 * All endpoints require ADMIN_SECRET bearer token.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import * as scraperDb from '../db/scraper';
import {
  getScraper,
  getScraperNames,
  searchAllRetailers,
  scrapeProductUrl,
  scrapeSetAcrossRetailers,
  getScraperStats,
  resetAllScraperCounts,
} from '../retailers';
import { AuthSessionManager } from '../scraper/auth';
import { pool } from '../lib/db';
import type { ScraperGameType } from '../types/scraper';

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_SECRET) { res.status(503).json({ error: 'Admin endpoints not configured' }); return; }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== env.ADMIN_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

const router = Router();
router.use(requireAdmin);

const authManager = new AuthSessionManager(pool);

// -- Status & management --

router.get('/status', async (_req, res) => {
  try {
    const stats = getScraperStats();
    const dbStats = await scraperDb.getScrapingStats();
    res.json({ success: true, data: { scrapers: stats, database: dbStats } });
  } catch (err) {
    logger.error({ err }, 'Failed to get scraper status');
    res.status(500).json({ success: false, error: 'Failed to get scraper status' });
  }
});

router.get('/retailers', (_req, res) => {
  res.json({ success: true, data: getScraperNames() });
});

router.post('/reset', (_req, res) => {
  resetAllScraperCounts();
  res.json({ success: true, message: 'Scraper counts reset' });
});

// -- Search --

router.get('/search', async (req, res) => {
  const { q, game, retailers, inStock, limit = '10' } = req.query;
  if (!q || typeof q !== 'string') {
    res.status(400).json({ success: false, error: 'Query param "q" is required' });
    return;
  }

  try {
    const retailerList = retailers ? String(retailers).split(',') : undefined;
    const { results, errors } = await searchAllRetailers(q, game as ScraperGameType, {
      retailers: retailerList,
      inStock: inStock === 'true',
      limit: parseInt(String(limit), 10),
    });
    res.json({ success: true, data: results, meta: { total: results.length, errors: errors.length ? errors : undefined } });
  } catch (err) {
    logger.error({ err, q }, 'Scraper search failed');
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

// -- Product scraping --

router.post('/product', async (req, res) => {
  const { url, retailer } = req.body;
  if (!url) { res.status(400).json({ success: false, error: 'URL is required' }); return; }

  try {
    const result = await scrapeProductUrl(url, retailer);
    if (result.listing) {
      const id = await scraperDb.upsertListing(result.listing);
      res.json({ success: true, data: { ...result.listing, id } });
    } else {
      res.status(404).json({ success: false, error: result.error || 'Product not found' });
    }
  } catch (err) {
    logger.error({ err, url }, 'Product scrape failed');
    res.status(500).json({ success: false, error: 'Product scrape failed' });
  }
});

router.post('/set', async (req, res) => {
  const { setName, game, retailers } = req.body;
  if (!setName || !game) {
    res.status(400).json({ success: false, error: 'setName and game are required' });
    return;
  }

  const jobId = await scraperDb.createScrapingJob(`Scrape set: ${setName}`, retailers?.join(','), game);
  scraperDb.startScrapingJob(jobId).catch(() => {});

  // Background scrape
  scrapeSetAcrossRetailers(setName, game as ScraperGameType, { retailers })
    .then(async ({ results, errors }) => {
      let newListings = 0;
      let updatedListings = 0;
      for (const listing of results) {
        try {
          const existing = await scraperDb.getListingByExternalId(listing.retailer, listing.externalId);
          await scraperDb.upsertListing(listing);
          if (existing) updatedListings++; else newListings++;
        } catch (e) { logger.error({ e }, 'Failed to save listing'); }
      }
      await scraperDb.updateScrapingJobProgress(jobId, {
        processedUrls: results.length, successfulScrapes: results.length,
        failedScrapes: errors.length, newListings, updatedListings,
      });
      await scraperDb.completeScrapingJob(jobId, errors.length === 0,
        errors.map((e) => ({ url: e.retailer, error: e.error })));
    })
    .catch(async (err) => {
      await scraperDb.completeScrapingJob(jobId, false, [{ url: 'set', error: String(err) }]);
    });

  res.json({ success: true, data: { jobId, message: 'Scraping job started' } });
});

// -- Listings --

router.get('/listings', async (req, res) => {
  const { game, retailer, productType, setName, status, minPrice, maxPrice, inStock, search, limit = '50', offset = '0' } = req.query;
  try {
    const { listings, total } = await scraperDb.getListings({
      game: game as string, retailer: retailer as string, productType: productType as string,
      setName: setName as string, status: status as string,
      minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
      inStock: inStock === 'true', search: search as string,
      limit: parseInt(limit as string, 10), offset: parseInt(offset as string, 10),
    });
    res.json({
      success: true, data: listings,
      meta: { total, page: Math.floor(parseInt(offset as string, 10) / parseInt(limit as string, 10)) + 1, limit: parseInt(limit as string, 10), hasMore: listings.length === parseInt(limit as string, 10) },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get listings');
    res.status(500).json({ success: false, error: 'Failed to get listings' });
  }
});

router.get('/listings/:id', async (req, res) => {
  try {
    const listing = await scraperDb.getListingById(req.params.id);
    if (!listing) { res.status(404).json({ success: false, error: 'Listing not found' }); return; }
    const priceHistory = await scraperDb.getScraperPriceHistory(req.params.id, 30);
    res.json({ success: true, data: { ...listing, priceHistory } });
  } catch (err) {
    logger.error({ err }, 'Failed to get listing');
    res.status(500).json({ success: false, error: 'Failed to get listing' });
  }
});

router.post('/listings/:id/refresh', async (req, res) => {
  try {
    const listing = await scraperDb.getListingById(req.params.id);
    if (!listing) { res.status(404).json({ success: false, error: 'Listing not found' }); return; }
    const result = await scrapeProductUrl((listing as any).product_url, (listing as any).retailer);
    if (result.listing) {
      await scraperDb.upsertListing(result.listing);
      res.json({ success: true, data: result.listing });
    } else {
      res.status(404).json({ success: false, error: result.error || 'Failed to refresh' });
    }
  } catch (err) {
    logger.error({ err }, 'Failed to refresh listing');
    res.status(500).json({ success: false, error: 'Failed to refresh listing' });
  }
});

// -- Changes --

router.get('/changes', async (req, res) => {
  const { type, retailer, limit = '50' } = req.query;
  try {
    const changes = await scraperDb.getRecentChanges({
      changeType: type as string, retailer: retailer as string,
      limit: parseInt(limit as string, 10),
    });
    res.json({ success: true, data: changes });
  } catch (err) {
    logger.error({ err }, 'Failed to get changes');
    res.status(500).json({ success: false, error: 'Failed to get changes' });
  }
});

// -- Jobs --

router.get('/jobs', async (req, res) => {
  try {
    const jobs = await scraperDb.getScrapingJobs(parseInt(String(req.query.limit || 10), 10));
    res.json({ success: true, data: jobs });
  } catch (err) {
    logger.error({ err }, 'Failed to get jobs');
    res.status(500).json({ success: false, error: 'Failed to get jobs' });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const jobs = await scraperDb.getScrapingJobs(100);
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return; }
    res.json({ success: true, data: job });
  } catch (err) {
    logger.error({ err }, 'Failed to get job');
    res.status(500).json({ success: false, error: 'Failed to get job' });
  }
});

// -- Auth Sessions --

router.post('/auth/import', async (req, res) => {
  const { retailer, cookies, headers, expiresInHours } = req.body;
  if (!retailer || !cookies) {
    res.status(400).json({ success: false, error: 'retailer and cookies are required' });
    return;
  }
  try {
    await authManager.importCookies(retailer, cookies, headers, expiresInHours);
    res.json({ success: true, message: `Auth cookies imported for ${retailer}` });
  } catch (err) {
    logger.error({ err }, 'Failed to import auth cookies');
    res.status(500).json({ success: false, error: 'Failed to import cookies' });
  }
});

router.post('/auth/login', async (req, res) => {
  const { retailer, credentials, method = 'http' } = req.body;
  if (!retailer || !credentials) {
    res.status(400).json({ success: false, error: 'retailer and credentials are required' });
    return;
  }
  try {
    const success = method === 'browser'
      ? await authManager.browserLogin(retailer, credentials)
      : await authManager.httpLogin(retailer, credentials);
    res.json({ success, message: success ? 'Login successful' : 'Login failed' });
  } catch (err) {
    logger.error({ err }, 'Login failed');
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

router.get('/auth/sessions', async (_req, res) => {
  try {
    const sessions = await authManager.listSessions();
    res.json({ success: true, data: sessions });
  } catch (err) {
    logger.error({ err }, 'Failed to list sessions');
    res.status(500).json({ success: false, error: 'Failed to list sessions' });
  }
});

router.delete('/auth/sessions/:retailer', async (req, res) => {
  try {
    await authManager.clearSession(req.params.retailer);
    res.json({ success: true, message: 'Session cleared' });
  } catch (err) {
    logger.error({ err }, 'Failed to clear session');
    res.status(500).json({ success: false, error: 'Failed to clear session' });
  }
});

export { router as scraperRouter };
