/**
 * Replenishment API routes — mounted at /admin/replenishment.
 * Inventory replenishment management and purchase order tracking.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import { pool } from '../lib/db';
import * as scraperDb from '../db/scraper';
import type { ScraperGameType } from '../types/scraper';

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_SECRET) { res.status(503).json({ error: 'Admin endpoints not configured' }); return; }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== env.ADMIN_SECRET) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

const router = Router();
router.use(requireAdmin);

// -- Replenishment Needs --

router.get('/needs', async (req, res) => {
  try {
    const needs = await scraperDb.getReplenishmentNeeds(
      req.query.status as string,
      req.query.priority as string,
    );
    res.json({ success: true, data: needs });
  } catch (err) {
    logger.error({ err }, 'Failed to get replenishment needs');
    res.status(500).json({ success: false, error: 'Failed to get needs' });
  }
});

router.post('/needs', async (req, res) => {
  const { productName, game, setName, currentStock, desiredStock, reason } = req.body;
  if (!productName || !game || desiredStock === undefined) {
    res.status(400).json({ success: false, error: 'productName, game, desiredStock required' });
    return;
  }

  try {
    const shortage = Math.max(0, desiredStock - (currentStock || 0));
    const bestPrice = await scraperDb.getLowestPrice(productName);

    let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    if (shortage > 20) priority = 'critical';
    else if (shortage > 10) priority = 'high';
    else if (shortage === 0) priority = 'low';

    const id = await scraperDb.createReplenishmentNeed({
      productName,
      game: game as ScraperGameType,
      setName,
      currentStock: currentStock || 0,
      desiredStock,
      shortage,
      bestPrice: bestPrice?.price,
      bestRetailer: bestPrice?.retailer,
      bestListingId: bestPrice?.listingId,
      priority,
      reason: reason || `Shortage of ${shortage} units`,
    });

    res.json({ success: true, data: { id } });
  } catch (err) {
    logger.error({ err }, 'Failed to create replenishment need');
    res.status(500).json({ success: false, error: 'Failed to create need' });
  }
});

router.post('/needs/:id/resolve', async (req, res) => {
  try {
    await scraperDb.resolveReplenishmentNeed(req.params.id);
    res.json({ success: true, message: 'Need resolved' });
  } catch (err) {
    logger.error({ err }, 'Failed to resolve need');
    res.status(500).json({ success: false, error: 'Failed to resolve need' });
  }
});

router.post('/analyze', async (req, res) => {
  const { inventory, game } = req.body;
  if (!Array.isArray(inventory)) {
    res.status(400).json({ success: false, error: 'inventory array required' });
    return;
  }

  try {
    const needs = [];
    for (const item of inventory) {
      const { productName, setName, currentStock, desiredStock, reorderPoint } = item;
      if (currentStock <= (reorderPoint || desiredStock * 0.2)) {
        const shortage = desiredStock - currentStock;
        const bestPrice = await scraperDb.getLowestPrice(productName);

        let priority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
        if (currentStock === 0) priority = 'critical';
        else if (shortage > 10) priority = 'high';

        const need = {
          productName,
          game: (game || item.game) as ScraperGameType,
          setName,
          currentStock,
          desiredStock,
          shortage,
          bestPrice: bestPrice?.price,
          bestRetailer: bestPrice?.retailer,
          priority,
          reason: currentStock === 0 ? 'Out of stock' : `Below reorder point (${currentStock}/${reorderPoint})`,
        };

        const id = await scraperDb.createReplenishmentNeed(need);
        needs.push({ id, ...need });
      }
    }

    res.json({ success: true, data: needs, meta: { totalAnalyzed: inventory.length, needsGenerated: needs.length } });
  } catch (err) {
    logger.error({ err }, 'Failed to analyze inventory');
    res.status(500).json({ success: false, error: 'Failed to analyze' });
  }
});

// -- Purchase Orders --

router.get('/orders', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM purchase_orders ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to get purchase orders');
    res.status(500).json({ success: false, error: 'Failed to get orders' });
  }
});

router.post('/orders', async (req, res) => {
  const { retailer, items, notes } = req.body;
  if (!retailer || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ success: false, error: 'retailer and items array required' });
    return;
  }

  try {
    const subtotal = items.reduce((s: number, i: { total: number }) => s + i.total, 0);
    const tax = subtotal * 0.08;
    const total = subtotal + tax;

    const orderResult = await pool.query(
      `INSERT INTO purchase_orders (status, retailer, subtotal, tax, shipping, total, currency, notes)
       VALUES ('draft', $1, $2, $3, 0, $4, 'USD', $5) RETURNING id`,
      [retailer, subtotal, tax, total, notes],
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await pool.query(
        `INSERT INTO purchase_order_items (order_id, listing_id, name, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.listingId, item.name, item.quantity, item.unitPrice, item.total],
      );
    }

    res.json({ success: true, data: { id: orderId } });
  } catch (err) {
    logger.error({ err }, 'Failed to create order');
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const order = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (!order.rows.length) { res.status(404).json({ success: false, error: 'Order not found' }); return; }
    const items = await pool.query('SELECT * FROM purchase_order_items WHERE order_id = $1', [req.params.id]);
    res.json({ success: true, data: { ...order.rows[0], items: items.rows } });
  } catch (err) {
    logger.error({ err }, 'Failed to get order');
    res.status(500).json({ success: false, error: 'Failed to get order' });
  }
});

router.patch('/orders/:id/status', async (req, res) => {
  const { status, orderNumber, trackingNumber, expectedDelivery } = req.body;
  if (!status) { res.status(400).json({ success: false, error: 'status required' }); return; }

  try {
    const updates: string[] = ['status = $1'];
    const vals: unknown[] = [status, req.params.id];
    let idx = 3;

    if (orderNumber) { updates.push(`order_number = $${idx++}`); vals.push(orderNumber); }
    if (trackingNumber) { updates.push(`tracking_number = $${idx++}`); vals.push(trackingNumber); }
    if (expectedDelivery) { updates.push(`expected_delivery = $${idx++}`); vals.push(expectedDelivery); }
    if (status === 'ordered') updates.push('ordered_at = NOW()');
    if (status === 'received') updates.push('received_at = NOW()');

    await pool.query(`UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = $2`, vals);
    res.json({ success: true, message: 'Order status updated' });
  } catch (err) {
    logger.error({ err }, 'Failed to update order');
    res.status(500).json({ success: false, error: 'Failed to update order' });
  }
});

// -- Sourcing --

router.get('/source', async (req, res) => {
  const { product, condition, quantity = '1' } = req.query;
  if (!product) { res.status(400).json({ success: false, error: 'product param required' }); return; }

  try {
    const result = await pool.query(
      `SELECT * FROM scraped_listings
       WHERE name ILIKE $1 AND is_active = TRUE AND status = 'in_stock'
       AND ($2::text IS NULL OR condition = $2)
       ORDER BY price ASC LIMIT 20`,
      [`%${product}%`, condition || null],
    );
    const qty = parseInt(quantity as string, 10);
    const listings = result.rows.filter((l: { quantity?: number }) => (l.quantity || 999) >= qty);

    res.json({
      success: true,
      data: listings,
      meta: { total: listings.length, bestPrice: listings[0]?.price || null },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to source product');
    res.status(500).json({ success: false, error: 'Failed to source' });
  }
});

export { router as replenishmentRouter };
