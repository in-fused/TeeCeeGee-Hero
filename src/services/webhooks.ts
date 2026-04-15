/**
 * Webhook Service
 *
 * Database-backed webhook subscription and delivery system.
 * Processes event notifications with exponential backoff retry.
 *
 * Adapted from kimi-api branch webhookService.ts (in-memory Maps)
 * to use PostgreSQL for persistence and reliability.
 */

import { Pool } from 'pg';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../lib/logger';

export type WebhookEventType =
  | 'inventory.updated'
  | 'inventory.low_stock'
  | 'inventory.restocked'
  | 'shipment.created'
  | 'shipment.updated'
  | 'shipment.delivered'
  | 'receiving.completed'
  | 'price.changed';

export interface WebhookSubscription {
  id: number;
  url: string;
  events: string[];
  secret: string;
  is_active: boolean;
  created_at: string;
  last_triggered_at: string | null;
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS = [1000, 5000, 15000, 30000, 60000];

export class WebhookService {
  constructor(private pool: Pool) {}

  /** Create a new webhook subscription */
  async createSubscription(
    url: string,
    events: WebhookEventType[],
    secret: string,
  ): Promise<WebhookSubscription> {
    const result = await this.pool.query(
      `INSERT INTO webhook_subscriptions (url, events, secret)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [url, events, secret],
    );
    return result.rows[0];
  }

  /** List all subscriptions */
  async getSubscriptions(activeOnly = false): Promise<WebhookSubscription[]> {
    const where = activeOnly ? 'WHERE is_active = true' : '';
    const result = await this.pool.query(
      `SELECT * FROM webhook_subscriptions ${where} ORDER BY created_at DESC`,
    );
    return result.rows;
  }

  /** Get a single subscription */
  async getSubscription(id: number): Promise<WebhookSubscription | null> {
    const result = await this.pool.query('SELECT * FROM webhook_subscriptions WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  /** Update a subscription */
  async updateSubscription(
    id: number,
    updates: { url?: string; events?: WebhookEventType[]; is_active?: boolean },
  ): Promise<WebhookSubscription | null> {
    const sets: string[] = [];
    const params: (string | boolean | string[])[] = [];
    let idx = 1;

    if (updates.url !== undefined) {
      sets.push(`url = $${idx++}`);
      params.push(updates.url);
    }
    if (updates.events !== undefined) {
      sets.push(`events = $${idx++}`);
      params.push(updates.events);
    }
    if (updates.is_active !== undefined) {
      sets.push(`is_active = $${idx++}`);
      params.push(updates.is_active);
    }

    if (sets.length === 0) return this.getSubscription(id);

    params.push(String(id));
    const result = await this.pool.query(
      `UPDATE webhook_subscriptions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );
    return result.rows[0] || null;
  }

  /** Delete a subscription */
  async deleteSubscription(id: number): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM webhook_subscriptions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Emit an event to all matching active subscriptions */
  async emitEvent(eventType: WebhookEventType, payload: unknown): Promise<void> {
    const subscriptions = await this.pool.query(
      `SELECT * FROM webhook_subscriptions WHERE is_active = true AND $1 = ANY(events)`,
      [eventType],
    );

    for (const sub of subscriptions.rows) {
      const eventPayload = {
        eventType,
        payload,
        timestamp: new Date().toISOString(),
        signature: this.generateSignature(payload, sub.secret),
      };

      // Insert delivery record
      const delivery = await this.pool.query(
        `INSERT INTO webhook_deliveries (subscription_id, event_type, payload, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
        [sub.id, eventType, JSON.stringify(eventPayload)],
      );

      // Attempt delivery (non-blocking)
      this.attemptDelivery(delivery.rows[0].id, sub.url, eventPayload).catch((err) => {
        logger.error({ err, subscriptionId: sub.id }, 'Webhook delivery failed');
      });
    }
  }

  private async attemptDelivery(
    deliveryId: number,
    url: string,
    payload: unknown,
    attempt = 1,
  ): Promise<void> {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': String(deliveryId),
          'X-Attempt-Number': String(attempt),
        },
        timeout: 10_000,
      });

      await this.pool.query(
        `UPDATE webhook_deliveries
         SET status = 'delivered', attempts = $2, last_attempt_at = NOW(), response_status = $3
         WHERE id = $1`,
        [deliveryId, attempt, response.status],
      );

      // Update last_triggered_at on the subscription
      await this.pool.query(
        `UPDATE webhook_subscriptions SET last_triggered_at = NOW()
         WHERE id = (SELECT subscription_id FROM webhook_deliveries WHERE id = $1)`,
        [deliveryId],
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const responseStatus = axios.isAxiosError(err) ? err.response?.status : null;

      await this.pool.query(
        `UPDATE webhook_deliveries
         SET status = 'failed', attempts = $2, last_attempt_at = NOW(), error = $3, response_status = $4
         WHERE id = $1`,
        [deliveryId, attempt, errorMsg, responseStatus],
      );

      // Retry with exponential backoff
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS[attempt - 1] || 60000;
        setTimeout(() => this.attemptDelivery(deliveryId, url, payload, attempt + 1), delay);
      }
    }
  }

  private generateSignature(payload: unknown, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return `sha256=${hmac.digest('hex')}`;
  }

  /** Get delivery status for a subscription */
  async getDeliveries(subscriptionId: number): Promise<unknown[]> {
    const result = await this.pool.query(
      `SELECT * FROM webhook_deliveries WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [subscriptionId],
    );
    return result.rows;
  }

  /** Get webhook health stats */
  async getHealth(): Promise<{
    total_subscriptions: number;
    active_subscriptions: number;
    total_deliveries: number;
    successful_deliveries: number;
    failed_deliveries: number;
  }> {
    const [subs, deliveries] = await Promise.all([
      this.pool.query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE is_active = true) as active
         FROM webhook_subscriptions`,
      ),
      this.pool.query(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'delivered') as successful,
           COUNT(*) FILTER (WHERE status = 'failed') as failed
         FROM webhook_deliveries`,
      ),
    ]);

    return {
      total_subscriptions: Number(subs.rows[0].total),
      active_subscriptions: Number(subs.rows[0].active),
      total_deliveries: Number(deliveries.rows[0].total),
      successful_deliveries: Number(deliveries.rows[0].successful),
      failed_deliveries: Number(deliveries.rows[0].failed),
    };
  }

  /** Get all supported event types with descriptions */
  static getEventTypes(): Array<{ type: WebhookEventType; description: string }> {
    return [
      {
        type: 'inventory.updated',
        description: 'Inventory quantity or price has changed',
      },
      {
        type: 'inventory.low_stock',
        description: 'Item has fallen below reorder point',
      },
      {
        type: 'inventory.restocked',
        description: 'Item has been restocked',
      },
      {
        type: 'shipment.created',
        description: 'New shipment has been created',
      },
      {
        type: 'shipment.updated',
        description: 'Shipment status has been updated',
      },
      {
        type: 'shipment.delivered',
        description: 'Shipment has been delivered',
      },
      {
        type: 'receiving.completed',
        description: 'Receiving process has been completed',
      },
      { type: 'price.changed', description: 'Card market price has changed significantly' },
    ];
  }
}
