import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../lib/env';
import { pool } from '../lib/db';
import { logger } from '../lib/logger';
import { WebhookService } from '../services/webhooks';

const router = Router();
const webhookService = new WebhookService(pool);

// Auth middleware — webhook management requires ADMIN_SECRET
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_SECRET) {
    res.status(503).json({ error: 'Admin endpoints not configured' });
    return;
  }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// GET /webhooks/events — list available event types (public)
router.get('/events', (_req: Request, res: Response) => {
  res.json({ events: WebhookService.getEventTypes() });
});

// GET /webhooks/health — webhook system health (public)
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await webhookService.getHealth();
    res.json(health);
  } catch (err) {
    logger.error({ err }, 'Webhook health check failed');
    res.status(500).json({ status: 'ERROR', message: 'Webhook health check failed' });
  }
});

// All routes below require admin auth
router.use(requireAdmin);

// POST /webhooks — create subscription
router.post('/', async (req: Request, res: Response) => {
  try {
    const { url, events, secret } = req.body;

    if (!url || !events || !Array.isArray(events) || !secret) {
      res.status(400).json({ error: 'url, events (array), and secret are required' });
      return;
    }

    const subscription = await webhookService.createSubscription(url, events, secret);
    res.status(201).json({ status: 'OK', subscription });
  } catch (err) {
    logger.error({ err }, 'Failed to create webhook subscription');
    res.status(500).json({ status: 'ERROR', message: 'Failed to create subscription' });
  }
});

// GET /webhooks — list subscriptions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const subscriptions = await webhookService.getSubscriptions();
    res.json({ subscriptions });
  } catch (err) {
    logger.error({ err }, 'Failed to list webhook subscriptions');
    res.status(500).json({ status: 'ERROR', message: 'Failed to list subscriptions' });
  }
});

// GET /webhooks/:id — get subscription
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Valid subscription ID required' });
      return;
    }

    const subscription = await webhookService.getSubscription(id);
    if (!subscription) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json({ subscription });
  } catch (err) {
    logger.error({ err }, 'Failed to get webhook subscription');
    res.status(500).json({ status: 'ERROR', message: 'Failed to get subscription' });
  }
});

// PATCH /webhooks/:id — update subscription
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Valid subscription ID required' });
      return;
    }

    const { url, events, is_active } = req.body;
    const subscription = await webhookService.updateSubscription(id, { url, events, is_active });

    if (!subscription) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json({ status: 'OK', subscription });
  } catch (err) {
    logger.error({ err }, 'Failed to update webhook subscription');
    res.status(500).json({ status: 'ERROR', message: 'Failed to update subscription' });
  }
});

// DELETE /webhooks/:id — delete subscription
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Valid subscription ID required' });
      return;
    }

    const deleted = await webhookService.deleteSubscription(id);
    if (!deleted) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json({ status: 'OK' });
  } catch (err) {
    logger.error({ err }, 'Failed to delete webhook subscription');
    res.status(500).json({ status: 'ERROR', message: 'Failed to delete subscription' });
  }
});

// GET /webhooks/:id/deliveries — list deliveries for a subscription
router.get('/:id/deliveries', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'Valid subscription ID required' });
      return;
    }

    const deliveries = await webhookService.getDeliveries(id);
    res.json({ subscription_id: id, deliveries });
  } catch (err) {
    logger.error({ err }, 'Failed to list webhook deliveries');
    res.status(500).json({ status: 'ERROR', message: 'Failed to list deliveries' });
  }
});

export { router as webhookRouter, webhookService };
