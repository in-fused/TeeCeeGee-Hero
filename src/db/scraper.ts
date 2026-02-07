/**
 * Database operations for the scraper module.
 * Reuses the existing connection pool from src/lib/db.ts.
 */

import { pool } from '../lib/db';
import { logger } from '../lib/logger';
import type { ScrapedListing, InventoryChange, PricePoint, ReplenishmentNeed, ScrapingJob } from '../types/scraper';

// ============================================================================
// Scraped Listings
// ============================================================================

export async function upsertListing(listing: ScrapedListing): Promise<string> {
  const result = await pool.query(
    `INSERT INTO scraped_listings (
       external_id, retailer, product_url, name, game, product_type,
       set_name, set_code, card_number, rarity, condition, language,
       price, currency, msrp, discount, status, quantity, image_url,
       raw_data, scraped_at, updated_at, last_seen_at, is_active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),NOW(),NOW(),TRUE)
     ON CONFLICT (retailer, external_id) DO UPDATE SET
       name = EXCLUDED.name,
       product_type = EXCLUDED.product_type,
       set_name = EXCLUDED.set_name,
       set_code = EXCLUDED.set_code,
       card_number = EXCLUDED.card_number,
       rarity = EXCLUDED.rarity,
       condition = EXCLUDED.condition,
       language = EXCLUDED.language,
       price = EXCLUDED.price,
       currency = EXCLUDED.currency,
       msrp = EXCLUDED.msrp,
       discount = EXCLUDED.discount,
       status = EXCLUDED.status,
       quantity = EXCLUDED.quantity,
       image_url = EXCLUDED.image_url,
       raw_data = EXCLUDED.raw_data,
       updated_at = NOW(),
       last_seen_at = NOW(),
       is_active = TRUE
     RETURNING id`,
    [
      listing.externalId, listing.retailer, listing.productUrl, listing.name,
      listing.game, listing.productType, listing.setName, listing.setCode,
      listing.cardNumber, listing.rarity, listing.condition, listing.language,
      listing.price, listing.currency, listing.msrp, listing.discount,
      listing.status, listing.quantity, listing.imageUrl,
      listing.rawData ? JSON.stringify(listing.rawData) : null,
    ],
  );
  return result.rows[0].id;
}

export async function getListingById(id: string): Promise<ScrapedListing | null> {
  const result = await pool.query('SELECT * FROM scraped_listings WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getListingByExternalId(
  retailer: string,
  externalId: string,
): Promise<ScrapedListing | null> {
  const result = await pool.query(
    'SELECT * FROM scraped_listings WHERE retailer = $1 AND external_id = $2',
    [retailer, externalId],
  );
  return result.rows[0] || null;
}

export async function getListings(filters: {
  game?: string;
  retailer?: string;
  productType?: string;
  setName?: string;
  status?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ listings: ScrapedListing[]; total: number }> {
  const conds: string[] = ['is_active = TRUE'];
  const vals: unknown[] = [];
  let idx = 1;

  if (filters.game) { conds.push(`game = $${idx++}`); vals.push(filters.game); }
  if (filters.retailer) { conds.push(`retailer = $${idx++}`); vals.push(filters.retailer); }
  if (filters.productType) { conds.push(`product_type = $${idx++}`); vals.push(filters.productType); }
  if (filters.setName) { conds.push(`set_name ILIKE $${idx++}`); vals.push(`%${filters.setName}%`); }
  if (filters.status) { conds.push(`status = $${idx++}`); vals.push(filters.status); }
  if (filters.minPrice !== undefined) { conds.push(`price >= $${idx++}`); vals.push(filters.minPrice); }
  if (filters.maxPrice !== undefined) { conds.push(`price <= $${idx++}`); vals.push(filters.maxPrice); }
  if (filters.inStock) { conds.push(`(status = 'in_stock' OR status = 'preorder')`); }
  if (filters.search) {
    conds.push(`to_tsvector('english', name || ' ' || COALESCE(set_name, '')) @@ plainto_tsquery('english', $${idx++})`);
    vals.push(filters.search);
  }

  const where = conds.join(' AND ');
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const countRes = await pool.query(`SELECT COUNT(*) FROM scraped_listings WHERE ${where}`, vals);
  const total = parseInt(countRes.rows[0].count);

  const dataRes = await pool.query(
    `SELECT * FROM scraped_listings WHERE ${where} ORDER BY scraped_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...vals, limit, offset],
  );
  return { listings: dataRes.rows, total };
}

// ============================================================================
// Price History (for scraped listings — separate from product price_history)
// ============================================================================

export async function getScraperPriceHistory(listingId: string, days = 30): Promise<PricePoint[]> {
  const result = await pool.query(
    `SELECT * FROM scraper_price_history
     WHERE listing_id = $1 AND recorded_at > NOW() - INTERVAL '1 day' * $2
     ORDER BY recorded_at ASC`,
    [listingId, days],
  );
  return result.rows;
}

export async function getLowestPrice(
  name: string,
  condition?: string,
): Promise<{ price: number; retailer: string; listingId: string } | null> {
  let query = `SELECT price, retailer, id as "listingId"
               FROM scraped_listings
               WHERE name ILIKE $1 AND is_active = TRUE AND status = 'in_stock'`;
  const vals: unknown[] = [`%${name}%`];
  if (condition) { query += ` AND condition = $2`; vals.push(condition); }
  query += ' ORDER BY price ASC LIMIT 1';
  const result = await pool.query(query, vals);
  return result.rows[0] || null;
}

// ============================================================================
// Inventory Changes
// ============================================================================

export async function getRecentChanges(options: {
  changeType?: string;
  retailer?: string;
  limit?: number;
}): Promise<InventoryChange[]> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (options.changeType) { conds.push(`c.change_type = $${idx++}`); vals.push(options.changeType); }
  if (options.retailer) { conds.push(`c.retailer = $${idx++}`); vals.push(options.retailer); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT c.*, l.name, l.game, l.set_name
     FROM inventory_changes c
     JOIN scraped_listings l ON c.listing_id = l.id
     ${where}
     ORDER BY c.detected_at DESC
     LIMIT $${idx}`,
    [...vals, options.limit || 50],
  );
  return result.rows;
}

// ============================================================================
// Replenishment
// ============================================================================

export async function createReplenishmentNeed(
  need: Omit<ReplenishmentNeed, 'id' | 'alternatives'> & { bestListingId?: string },
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO replenishment_needs (
       product_name, game, set_name, current_stock, desired_stock, shortage,
       best_price, best_retailer, best_listing_id, priority, reason, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open')
     RETURNING id`,
    [
      need.productName, need.game, need.setName, need.currentStock,
      need.desiredStock, need.shortage, need.bestPrice, need.bestRetailer,
      need.bestListingId, need.priority, need.reason,
    ],
  );
  return result.rows[0].id;
}

export async function getReplenishmentNeeds(
  status?: string,
  priority?: string,
): Promise<ReplenishmentNeed[]> {
  let query = 'SELECT * FROM replenishment_needs WHERE 1=1';
  const vals: unknown[] = [];
  if (status) { query += ` AND status = $${vals.length + 1}`; vals.push(status); }
  if (priority) { query += ` AND priority = $${vals.length + 1}`; vals.push(priority); }
  query += ' ORDER BY priority ASC, created_at ASC';
  const result = await pool.query(query, vals);
  return result.rows;
}

export async function resolveReplenishmentNeed(id: string): Promise<void> {
  await pool.query(
    `UPDATE replenishment_needs SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
    [id],
  );
}

// ============================================================================
// Scraping Jobs
// ============================================================================

export async function createScrapingJob(
  name: string,
  retailer?: string,
  game?: string,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO scraping_jobs (name, status, retailer, game) VALUES ($1, 'pending', $2, $3) RETURNING id`,
    [name, retailer, game],
  );
  return result.rows[0].id;
}

export async function startScrapingJob(id: string): Promise<void> {
  await pool.query(
    `UPDATE scraping_jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function updateScrapingJobProgress(
  id: string,
  progress: {
    processedUrls?: number;
    successfulScrapes?: number;
    failedScrapes?: number;
    newListings?: number;
    updatedListings?: number;
  },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  let idx = 2;

  if (progress.processedUrls !== undefined) { sets.push(`processed_urls = $${idx++}`); vals.push(progress.processedUrls); }
  if (progress.successfulScrapes !== undefined) { sets.push(`successful_scrapes = $${idx++}`); vals.push(progress.successfulScrapes); }
  if (progress.failedScrapes !== undefined) { sets.push(`failed_scrapes = $${idx++}`); vals.push(progress.failedScrapes); }
  if (progress.newListings !== undefined) { sets.push(`new_listings = $${idx++}`); vals.push(progress.newListings); }
  if (progress.updatedListings !== undefined) { sets.push(`updated_listings = $${idx++}`); vals.push(progress.updatedListings); }

  if (sets.length === 0) return;
  await pool.query(`UPDATE scraping_jobs SET ${sets.join(', ')} WHERE id = $1`, vals);
}

export async function completeScrapingJob(
  id: string,
  success: boolean,
  errors?: Array<{ url: string; error: string }>,
): Promise<void> {
  await pool.query(
    `UPDATE scraping_jobs SET status = $1, completed_at = NOW(), errors = $2 WHERE id = $3`,
    [success ? 'completed' : 'failed', JSON.stringify(errors || []), id],
  );
}

export async function getScrapingJobs(limit = 10): Promise<ScrapingJob[]> {
  const result = await pool.query(
    'SELECT * FROM scraping_jobs ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return result.rows;
}

// ============================================================================
// Analytics
// ============================================================================

export async function getScrapingStats(): Promise<{
  totalListings: number;
  activeListings: number;
  byRetailer: Array<{ retailer: string; count: number }>;
  byGame: Array<{ game: string; count: number }>;
  recentChanges: number;
}> {
  const [total, active, byRetailer, byGame, changes] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM scraped_listings'),
    pool.query('SELECT COUNT(*) FROM scraped_listings WHERE is_active = TRUE'),
    pool.query('SELECT retailer, COUNT(*)::int as count FROM scraped_listings WHERE is_active = TRUE GROUP BY retailer ORDER BY count DESC'),
    pool.query('SELECT game, COUNT(*)::int as count FROM scraped_listings WHERE is_active = TRUE GROUP BY game ORDER BY count DESC'),
    pool.query("SELECT COUNT(*) FROM inventory_changes WHERE detected_at > NOW() - INTERVAL '24 hours'"),
  ]);

  return {
    totalListings: parseInt(total.rows[0].count),
    activeListings: parseInt(active.rows[0].count),
    byRetailer: byRetailer.rows,
    byGame: byGame.rows,
    recentChanges: parseInt(changes.rows[0].count),
  };
}
