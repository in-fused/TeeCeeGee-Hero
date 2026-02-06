/**
 * Database module for scraped listings
 * Integrates with existing PackFinder Postgres pool
 */

import { Pool, PoolClient } from 'pg';
import { logger } from '../scraper/logger';
import type {
  ScrapedListing,
  InventorySnapshot,
  InventoryChange,
  PricePoint,
  ReplenishmentNeed,
  PurchaseOrder,
  ScrapingJob,
} from '../types';

// Re-export the pool from the main app (will be injected)
let pool: Pool | null = null;

export function setPool(p: Pool): void {
  pool = p;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call setPool() first.');
  }
  return pool;
}

// ============================================================================
// Scraped Listings CRUD
// ============================================================================

export async function upsertListing(listing: ScrapedListing): Promise<string> {
  const db = getPool();
  
  const query = `
    INSERT INTO scraped_listings (
      external_id, retailer, product_url, name, game, product_type,
      set_name, set_code, card_number, rarity, condition, language,
      price, currency, msrp, discount, status, quantity, image_url,
      raw_data, scraped_at, updated_at, last_seen_at, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW(), NOW(), TRUE)
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
    RETURNING id
  `;
  
  const values = [
    listing.externalId,
    listing.retailer,
    listing.productUrl,
    listing.name,
    listing.game,
    listing.productType,
    listing.setName,
    listing.setCode,
    listing.cardNumber,
    listing.rarity,
    listing.condition,
    listing.language,
    listing.price,
    listing.currency,
    listing.msrp,
    listing.discount,
    listing.status,
    listing.quantity,
    listing.imageUrl,
    listing.rawData ? JSON.stringify(listing.rawData) : null,
  ];
  
  const result = await db.query(query, values);
  return result.rows[0].id;
}

export async function getListingById(id: string): Promise<ScrapedListing | null> {
  const db = getPool();
  const result = await db.query('SELECT * FROM scraped_listings WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getListingByExternalId(
  retailer: string,
  externalId: string
): Promise<ScrapedListing | null> {
  const db = getPool();
  const result = await db.query(
    'SELECT * FROM scraped_listings WHERE retailer = $1 AND external_id = $2',
    [retailer, externalId]
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
} = {}): Promise<{ listings: ScrapedListing[]; total: number }> {
  const db = getPool();
  
  const conditions: string[] = ['is_active = TRUE'];
  const values: unknown[] = [];
  let paramIndex = 1;
  
  if (filters.game) {
    conditions.push(`game = $${paramIndex++}`);
    values.push(filters.game);
  }
  if (filters.retailer) {
    conditions.push(`retailer = $${paramIndex++}`);
    values.push(filters.retailer);
  }
  if (filters.productType) {
    conditions.push(`product_type = $${paramIndex++}`);
    values.push(filters.productType);
  }
  if (filters.setName) {
    conditions.push(`set_name ILIKE $${paramIndex++}`);
    values.push(`%${filters.setName}%`);
  }
  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(filters.status);
  }
  if (filters.minPrice !== undefined) {
    conditions.push(`price >= $${paramIndex++}`);
    values.push(filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    conditions.push(`price <= $${paramIndex++}`);
    values.push(filters.maxPrice);
  }
  if (filters.inStock) {
    conditions.push(`(status = 'in_stock' OR status = 'preorder')`);
  }
  if (filters.search) {
    conditions.push(`to_tsvector('english', name || ' ' || COALESCE(set_name, '')) @@ plainto_tsquery('english', $${paramIndex++})`);
    values.push(filters.search);
  }
  
  const whereClause = conditions.join(' AND ');
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  
  const countQuery = `SELECT COUNT(*) FROM scraped_listings WHERE ${whereClause}`;
  const countResult = await db.query(countQuery, values);
  const total = parseInt(countResult.rows[0].count);
  
  const query = `
    SELECT * FROM scraped_listings 
    WHERE ${whereClause}
    ORDER BY scraped_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;
  values.push(limit, offset);
  
  const result = await db.query(query, values);
  return { listings: result.rows, total };
}

export async function markListingsInactive(
  retailer: string,
  beforeDate: Date
): Promise<number> {
  const db = getPool();
  const result = await db.query(
    `UPDATE scraped_listings 
     SET is_active = FALSE 
     WHERE retailer = $1 AND last_seen_at < $2`,
    [retailer, beforeDate]
  );
  return result.rowCount || 0;
}

// ============================================================================
// Price History
// ============================================================================

export async function getPriceHistory(
  listingId: string,
  days: number = 30
): Promise<PricePoint[]> {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM price_history 
     WHERE listing_id = $1 AND recorded_at > NOW() - INTERVAL '${days} days'
     ORDER BY recorded_at ASC`,
    [listingId]
  );
  return result.rows;
}

export async function getLowestPrice(
  name: string,
  condition?: string
): Promise<{ price: number; retailer: string; listingId: string } | null> {
  const db = getPool();
  
  let query = `
    SELECT price, retailer, id as listing_id
    FROM scraped_listings
    WHERE name ILIKE $1 AND is_active = TRUE AND status = 'in_stock'
  `;
  const values: unknown[] = [`%${name}%`];
  
  if (condition) {
    query += ` AND condition = $2`;
    values.push(condition);
  }
  
  query += ` ORDER BY price ASC LIMIT 1`;
  
  const result = await db.query(query, values);
  return result.rows[0] || null;
}

// ============================================================================
// Inventory Changes
// ============================================================================

export async function getRecentChanges(
  options: {
    changeType?: string;
    retailer?: string;
    game?: string;
    limit?: number;
    notified?: boolean;
  } = {}
): Promise<InventoryChange[]> {
  const db = getPool();
  
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;
  
  if (options.changeType) {
    conditions.push(`change_type = $${paramIndex++}`);
    values.push(options.changeType);
  }
  if (options.retailer) {
    conditions.push(`retailer = $${paramIndex++}`);
    values.push(options.retailer);
  }
  if (options.notified !== undefined) {
    conditions.push(`notified = $${paramIndex++}`);
    values.push(options.notified);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT c.*, l.name, l.game, l.set_name
    FROM inventory_changes c
    JOIN scraped_listings l ON c.listing_id = l.id
    ${whereClause}
    ORDER BY c.detected_at DESC
    LIMIT $${paramIndex++}
  `;
  values.push(options.limit || 50);
  
  const result = await db.query(query, values);
  return result.rows;
}

export async function markChangesNotified(ids: string[]): Promise<void> {
  const db = getPool();
  await db.query(
    `UPDATE inventory_changes SET notified = TRUE WHERE id = ANY($1)`,
    [ids]
  );
}

// ============================================================================
// Replenishment
// ============================================================================

export async function createReplenishmentNeed(
  need: Omit<ReplenishmentNeed, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const db = getPool();
  
  const query = `
    INSERT INTO replenishment_needs (
      product_name, game, set_name, current_stock, desired_stock, shortage,
      best_price, best_retailer, best_listing_id, priority, reason, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open')
    ON CONFLICT (product_name, game, COALESCE(set_name, '')) 
    WHERE status = 'open'
    DO UPDATE SET
      current_stock = EXCLUDED.current_stock,
      desired_stock = EXCLUDED.desired_stock,
      shortage = EXCLUDED.shortage,
      best_price = EXCLUDED.best_price,
      best_retailer = EXCLUDED.best_retailer,
      best_listing_id = EXCLUDED.best_listing_id,
      priority = EXCLUDED.priority,
      reason = EXCLUDED.reason,
      updated_at = NOW()
    RETURNING id
  `;
  
  const result = await db.query(query, [
    need.productName,
    need.game,
    need.setName,
    need.currentStock,
    need.desiredStock,
    need.shortage,
    need.bestPrice,
    need.bestRetailer,
    need.bestListingId,
    need.priority,
    need.reason,
  ]);
  
  return result.rows[0].id;
}

export async function getReplenishmentNeeds(
  status?: string,
  priority?: string
): Promise<ReplenishmentNeed[]> {
  const db = getPool();
  
  let query = 'SELECT * FROM replenishment_needs WHERE 1=1';
  const values: unknown[] = [];
  
  if (status) {
    query += ` AND status = $${values.length + 1}`;
    values.push(status);
  }
  if (priority) {
    query += ` AND priority = $${values.length + 1}`;
    values.push(priority);
  }
  
  query += ' ORDER BY priority ASC, created_at ASC';
  
  const result = await db.query(query, values);
  return result.rows;
}

export async function resolveReplenishmentNeed(id: string): Promise<void> {
  const db = getPool();
  await db.query(
    `UPDATE replenishment_needs SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
    [id]
  );
}

// ============================================================================
// Scraping Jobs
// ============================================================================

export async function createScrapingJob(
  name: string,
  retailer?: string,
  game?: string
): Promise<string> {
  const db = getPool();
  const result = await db.query(
    `INSERT INTO scraping_jobs (name, status, retailer, game) VALUES ($1, 'pending', $2, $3) RETURNING id`,
    [name, retailer, game]
  );
  return result.rows[0].id;
}

export async function startScrapingJob(id: string): Promise<void> {
  const db = getPool();
  await db.query(
    `UPDATE scraping_jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
    [id]
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
  }
): Promise<void> {
  const db = getPool();
  
  const updates: string[] = [];
  const values: unknown[] = [id];
  let paramIndex = 2;
  
  if (progress.processedUrls !== undefined) {
    updates.push(`processed_urls = $${paramIndex++}`);
    values.push(progress.processedUrls);
  }
  if (progress.successfulScrapes !== undefined) {
    updates.push(`successful_scrapes = $${paramIndex++}`);
    values.push(progress.successfulScrapes);
  }
  if (progress.failedScrapes !== undefined) {
    updates.push(`failed_scrapes = $${paramIndex++}`);
    values.push(progress.failedScrapes);
  }
  if (progress.newListings !== undefined) {
    updates.push(`new_listings = $${paramIndex++}`);
    values.push(progress.newListings);
  }
  if (progress.updatedListings !== undefined) {
    updates.push(`updated_listings = $${paramIndex++}`);
    values.push(progress.updatedListings);
  }
  
  if (updates.length === 0) return;
  
  await db.query(
    `UPDATE scraping_jobs SET ${updates.join(', ')} WHERE id = $1`,
    values
  );
}

export async function completeScrapingJob(
  id: string,
  success: boolean,
  errors?: Array<{ url: string; error: string }>
): Promise<void> {
  const db = getPool();
  
  const status = success ? 'completed' : 'failed';
  const errorsJson = errors ? JSON.stringify(errors) : '[]';
  
  await db.query(
    `UPDATE scraping_jobs SET status = $1, completed_at = NOW(), errors = $2 WHERE id = $3`,
    [status, errorsJson, id]
  );
}

export async function getScrapingJobs(
  limit: number = 10
): Promise<ScrapingJob[]> {
  const db = getPool();
  const result = await db.query(
    `SELECT * FROM scraping_jobs ORDER BY created_at DESC LIMIT $1`,
    [limit]
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
  const db = getPool();
  
  const [totalResult, activeResult, retailerResult, gameResult, changesResult] = await Promise.all([
    db.query('SELECT COUNT(*) FROM scraped_listings'),
    db.query('SELECT COUNT(*) FROM scraped_listings WHERE is_active = TRUE'),
    db.query('SELECT retailer, COUNT(*) as count FROM scraped_listings WHERE is_active = TRUE GROUP BY retailer ORDER BY count DESC'),
    db.query('SELECT game, COUNT(*) as count FROM scraped_listings WHERE is_active = TRUE GROUP BY game ORDER BY count DESC'),
    db.query('SELECT COUNT(*) FROM inventory_changes WHERE detected_at > NOW() - INTERVAL \'24 hours\''),
  ]);
  
  return {
    totalListings: parseInt(totalResult.rows[0].count),
    activeListings: parseInt(activeResult.rows[0].count),
    byRetailer: retailerResult.rows,
    byGame: gameResult.rows,
    recentChanges: parseInt(changesResult.rows[0].count),
  };
}

// ============================================================================
// Database Health
// ============================================================================

export async function healthCheck(): Promise<boolean> {
  try {
    const db = getPool();
    const result = await db.query('SELECT 1');
    return result.rowCount === 1;
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return false;
  }
}
