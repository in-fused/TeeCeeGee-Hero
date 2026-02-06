/**
 * Replenishment API Routes
 * Endpoints for inventory replenishment management
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { logger } from '../scraper/logger';
import { setPool } from '../db';
import * as db from '../db';
import { getLowestPrice } from '../retailers';
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
export function createReplenishmentRouter(pool: Pool): Router {
  const router = Router();

  // Initialize database pool
  setPool(pool);

  // Apply admin auth to all routes
  router.use(requireAdmin);

  // ============================================================================
  // Replenishment Needs
  // ============================================================================

  /**
   * GET /replenishment/needs
   * Get all replenishment needs
   */
  router.get('/needs', async (req: Request, res: Response) => {
    const { status, priority } = req.query;

    try {
      const needs = await db.getReplenishmentNeeds(
        status as string,
        priority as string
      );

      res.json({
        success: true,
        data: needs,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get replenishment needs');
      res.status(500).json({
        success: false,
        error: 'Failed to get replenishment needs',
      });
    }
  });

  /**
   * POST /replenishment/needs
   * Create a new replenishment need
   */
  router.post('/needs', async (req: Request, res: Response) => {
    const {
      productName,
      game,
      setName,
      currentStock,
      desiredStock,
      reason,
    } = req.body;

    if (!productName || !game || desiredStock === undefined) {
      res.status(400).json({
        success: false,
        error: 'productName, game, and desiredStock are required',
      });
      return;
    }

    try {
      // Calculate shortage
      const shortage = Math.max(0, desiredStock - (currentStock || 0));

      // Find best price from scraped listings
      const bestPrice = await getLowestPrice(productName);

      // Determine priority
      let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      if (shortage > 20) priority = 'critical';
      else if (shortage > 10) priority = 'high';
      else if (shortage === 0) priority = 'low';

      const id = await db.createReplenishmentNeed({
        productName,
        game: game as GameType,
        setName,
        currentStock: currentStock || 0,
        desiredStock,
        shortage,
        bestPrice: bestPrice?.price,
        bestRetailer: bestPrice?.retailer,
        bestListingId: bestPrice?.listingId,
        priority,
        reason: reason || `Shortage of ${shortage} units`,
        alternatives: [],
      });

      res.json({
        success: true,
        data: { id },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create replenishment need');
      res.status(500).json({
        success: false,
        error: 'Failed to create replenishment need',
      });
    }
  });

  /**
   * POST /replenishment/needs/:id/resolve
   * Mark a replenishment need as resolved
   */
  router.post('/needs/:id/resolve', async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      await db.resolveReplenishmentNeed(id);

      res.json({
        success: true,
        message: 'Replenishment need resolved',
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to resolve replenishment need');
      res.status(500).json({
        success: false,
        error: 'Failed to resolve replenishment need',
      });
    }
  });

  /**
   * POST /replenishment/analyze
   * Analyze inventory and generate replenishment needs
   */
  router.post('/analyze', async (req: Request, res: Response) => {
    const { inventory, game } = req.body;

    if (!Array.isArray(inventory)) {
      res.status(400).json({
        success: false,
        error: 'inventory array is required',
      });
      return;
    }

    try {
      const needs = [];

      for (const item of inventory) {
        const {
          productName,
          setName,
          currentStock,
          desiredStock,
          reorderPoint,
        } = item;

        // Check if replenishment is needed
        if (currentStock <= (reorderPoint || desiredStock * 0.2)) {
          const shortage = desiredStock - currentStock;

          // Find best price
          const bestPrice = await getLowestPrice(productName);

          // Determine priority
          let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
          if (currentStock === 0) priority = 'critical';
          else if (shortage > 10) priority = 'high';

          const need = {
            productName,
            game: (game || item.game) as GameType,
            setName,
            currentStock,
            desiredStock,
            shortage,
            bestPrice: bestPrice?.price,
            bestRetailer: bestPrice?.retailer,
            priority,
            reason: currentStock === 0
              ? 'Out of stock'
              : `Below reorder point (${currentStock}/${reorderPoint})`,
          };

          // Save to database
          const id = await db.createReplenishmentNeed(need);
          needs.push({ id, ...need });
        }
      }

      res.json({
        success: true,
        data: needs,
        meta: {
          totalAnalyzed: inventory.length,
          needsGenerated: needs.length,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to analyze inventory');
      res.status(500).json({
        success: false,
        error: 'Failed to analyze inventory',
      });
    }
  });

  // ============================================================================
  // Purchase Orders
  // ============================================================================

  /**
   * GET /replenishment/orders
   * Get all purchase orders
   */
  router.get('/orders', async (_req: Request, res: Response) => {
    try {
      const pool = db.getPool();
      const result = await pool.query(
        'SELECT * FROM purchase_orders ORDER BY created_at DESC'
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get purchase orders');
      res.status(500).json({
        success: false,
        error: 'Failed to get purchase orders',
      });
    }
  });

  /**
   * POST /replenishment/orders
   * Create a new purchase order
   */
  router.post('/orders', async (req: Request, res: Response) => {
    const { retailer, items, notes } = req.body;

    if (!retailer || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        success: false,
        error: 'retailer and items array are required',
      });
      return;
    }

    try {
      const pool = db.getPool();

      // Calculate totals
      const subtotal = items.reduce((sum, item) => sum + item.total, 0);
      const tax = subtotal * 0.08; // 8% tax default
      const shipping = 0; // Calculate based on retailer
      const total = subtotal + tax + shipping;

      const result = await pool.query(
        `INSERT INTO purchase_orders (
          status, retailer, subtotal, tax, shipping, total, currency, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        ['draft', retailer, subtotal, tax, shipping, total, 'USD', notes]
      );

      const orderId = result.rows[0].id;

      // Insert items
      for (const item of items) {
        await pool.query(
          `INSERT INTO purchase_order_items (
            order_id, listing_id, name, quantity, unit_price, total
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, item.listingId, item.name, item.quantity, item.unitPrice, item.total]
        );
      }

      res.json({
        success: true,
        data: { id: orderId },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create purchase order');
      res.status(500).json({
        success: false,
        error: 'Failed to create purchase order',
      });
    }
  });

  /**
   * GET /replenishment/orders/:id
   * Get a specific purchase order
   */
  router.get('/orders/:id', async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const pool = db.getPool();

      const orderResult = await pool.query(
        'SELECT * FROM purchase_orders WHERE id = $1',
        [id]
      );

      if (orderResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Order not found',
        });
        return;
      }

      const itemsResult = await pool.query(
        'SELECT * FROM purchase_order_items WHERE order_id = $1',
        [id]
      );

      res.json({
        success: true,
        data: {
          ...orderResult.rows[0],
          items: itemsResult.rows,
        },
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to get purchase order');
      res.status(500).json({
        success: false,
        error: 'Failed to get purchase order',
      });
    }
  });

  /**
   * PATCH /replenishment/orders/:id/status
   * Update order status
   */
  router.patch('/orders/:id/status', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, orderNumber, trackingNumber, expectedDelivery } = req.body;

    if (!status) {
      res.status(400).json({
        success: false,
        error: 'status is required',
      });
      return;
    }

    try {
      const pool = db.getPool();

      const updates: string[] = ['status = $1'];
      const values: unknown[] = [status, id];
      let paramIndex = 3;

      if (orderNumber) {
        updates.push(`order_number = $${paramIndex++}`);
        values.push(orderNumber);
      }

      if (trackingNumber) {
        updates.push(`tracking_number = $${paramIndex++}`);
        values.push(trackingNumber);
      }

      if (expectedDelivery) {
        updates.push(`expected_delivery = $${paramIndex++}`);
        values.push(expectedDelivery);
      }

      // Set timestamp based on status
      if (status === 'ordered') {
        updates.push('ordered_at = NOW()');
      } else if (status === 'received') {
        updates.push('received_at = NOW()');
      }

      await pool.query(
        `UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = $2`,
        values
      );

      res.json({
        success: true,
        message: 'Order status updated',
      });
    } catch (error) {
      logger.error({ error, id }, 'Failed to update order status');
      res.status(500).json({
        success: false,
        error: 'Failed to update order status',
      });
    }
  });

  // ============================================================================
  // Sourcing
  // ============================================================================

  /**
   * GET /replenishment/source
   * Find best prices for a product across retailers
   */
  router.get('/source', async (req: Request, res: Response) => {
    const { product, condition, quantity = '1' } = req.query;

    if (!product) {
      res.status(400).json({
        success: false,
        error: 'product query parameter is required',
      });
      return;
    }

    try {
      const pool = db.getPool();

      // Find listings matching the product
      const result = await pool.query(
        `SELECT * FROM scraped_listings 
         WHERE name ILIKE $1 
         AND is_active = TRUE 
         AND status = 'in_stock'
         AND ($2::text IS NULL OR condition = $2)
         ORDER BY price ASC
         LIMIT 20`,
        [`%${product}%`, condition]
      );

      const qty = parseInt(quantity as string, 10);
      const listings = result.rows.filter(l => (l.quantity || 999) >= qty);

      // Group by retailer for comparison
      const byRetailer: Record<string, typeof listings> = {};
      for (const listing of listings) {
        if (!byRetailer[listing.retailer]) {
          byRetailer[listing.retailer] = [];
        }
        byRetailer[listing.retailer].push(listing);
      }

      res.json({
        success: true,
        data: listings,
        meta: {
          total: listings.length,
          byRetailer: Object.keys(byRetailer),
          bestPrice: listings[0]?.price || null,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to source product');
      res.status(500).json({
        success: false,
        error: 'Failed to source product',
      });
    }
  });

  /**
   * POST /replenishment/auto-order
   * Automatically create orders for replenishment needs
   */
  router.post('/auto-order', async (req: Request, res: Response) => {
    const { needs, maxOrders = 10 } = req.body;

    try {
      const pool = db.getPool();
      const orders = [];

      // Get open replenishment needs
      const needsToProcess = needs || await db.getReplenishmentNeeds('open');
      const limitedNeeds = needsToProcess.slice(0, maxOrders);

      for (const need of limitedNeeds) {
        if (!need.bestListingId || !need.bestPrice) {
          continue;
        }

        // Get listing details
        const listing = await db.getListingById(need.bestListingId);
        if (!listing) continue;

        // Create order
        const subtotal = need.shortage * need.bestPrice;
        const tax = subtotal * 0.08;
        const shipping = 0;
        const total = subtotal + tax + shipping;

        const orderResult = await pool.query(
          `INSERT INTO purchase_orders (
            status, retailer, subtotal, tax, shipping, total, currency
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          ['draft', need.bestRetailer, subtotal, tax, shipping, total, 'USD']
        );

        const orderId = orderResult.rows[0].id;

        // Add item
        await pool.query(
          `INSERT INTO purchase_order_items (
            order_id, listing_id, name, quantity, unit_price, total
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, need.bestListingId, need.productName, need.shortage, need.bestPrice, subtotal]
        );

        // Mark need as resolved
        await db.resolveReplenishmentNeed(need.id);

        orders.push({
          orderId,
          needId: need.id,
          productName: need.productName,
          retailer: need.bestRetailer,
          quantity: need.shortage,
          total,
        });
      }

      res.json({
        success: true,
        data: orders,
        meta: {
          totalCreated: orders.length,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create auto-orders');
      res.status(500).json({
        success: false,
        error: 'Failed to create auto-orders',
      });
    }
  });

  return router;
}
