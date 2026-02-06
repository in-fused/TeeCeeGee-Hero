import type { WebhookEvent, WebhookSubscription, WebhookEventType } from '@/types';

interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  url: string;
  payload: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt?: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: string;
}

class WebhookService {
  private subscriptions: Map<string, WebhookSubscription> = new Map();
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private eventQueue: WebhookEvent[] = [];
  private isProcessing = false;

  // Maximum delivery attempts
  private readonly MAX_ATTEMPTS = 5;
  // Retry delays in milliseconds (exponential backoff)
  private readonly RETRY_DELAYS = [1000, 5000, 15000, 30000, 60000];

  constructor() {
    // Start the event processor
    this.startEventProcessor();
  }

  // ========== Subscription Management ==========

  async createSubscription(
    url: string,
    events: WebhookEventType[],
    secret: string
  ): Promise<WebhookSubscription> {
    const subscription: WebhookSubscription = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url,
      events,
      secret,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  async getSubscription(subscriptionId: string): Promise<WebhookSubscription | null> {
    return this.subscriptions.get(subscriptionId) || null;
  }

  async getAllSubscriptions(): Promise<WebhookSubscription[]> {
    return Array.from(this.subscriptions.values());
  }

  async updateSubscription(
    subscriptionId: string,
    updates: Partial<Omit<WebhookSubscription, 'id' | 'createdAt'>>
  ): Promise<WebhookSubscription | null> {
    const subscription = this.subscriptions.get(subscriptionId);
    
    if (!subscription) return null;

    Object.assign(subscription, updates);
    this.subscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  async deleteSubscription(subscriptionId: string): Promise<boolean> {
    return this.subscriptions.delete(subscriptionId);
  }

  // ========== Event Generation ==========

  async emitEvent<T>(
    eventType: WebhookEventType,
    payload: T,
    options: {
      immediate?: boolean;
      delay?: number;
    } = {}
  ): Promise<WebhookEvent> {
    const event: WebhookEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      eventType,
      payload,
      timestamp: new Date().toISOString(),
      signature: await this.generateSignature(payload),
    };

    if (options.immediate) {
      await this.processEvent(event);
    } else if (options.delay) {
      setTimeout(() => this.queueEvent(event), options.delay);
    } else {
      this.queueEvent(event);
    }

    return event;
  }

  private queueEvent(event: WebhookEvent): void {
    this.eventQueue.push(event);
    this.processQueue();
  }

  // ========== Event Processing ==========

  private startEventProcessor(): void {
    // Process queue every 5 seconds
    setInterval(() => this.processQueue(), 5000);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.eventQueue.length === 0) return;

    this.isProcessing = true;

    try {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift();
        if (event) {
          await this.processEvent(event);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processEvent(event: WebhookEvent): Promise<void> {
    // Find all active subscriptions that want this event type
    const matchingSubscriptions = Array.from(this.subscriptions.values()).filter(
      sub => sub.isActive && sub.events.includes(event.eventType)
    );

    for (const subscription of matchingSubscriptions) {
      await this.deliverEvent(event, subscription);
    }
  }

  private async deliverEvent(
    event: WebhookEvent,
    subscription: WebhookSubscription
  ): Promise<void> {
    const deliveryId = `del-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const delivery: WebhookDelivery = {
      id: deliveryId,
      subscriptionId: subscription.id,
      eventId: event.id,
      url: subscription.url,
      payload: JSON.stringify(event),
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
    };

    this.deliveries.set(deliveryId, delivery);

    // Attempt delivery
    await this.attemptDelivery(delivery);
  }

  private async attemptDelivery(delivery: WebhookDelivery): Promise<void> {
    delivery.attempts++;
    delivery.lastAttemptAt = new Date().toISOString();

    try {
      const response = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': delivery.id,
          'X-Event-ID': delivery.eventId,
          'X-Attempt-Number': delivery.attempts.toString(),
          'X-Webhook-Signature': JSON.parse(delivery.payload).signature,
        },
        body: delivery.payload,
      });

      delivery.responseStatus = response.status;
      delivery.responseBody = await response.text();

      if (response.ok) {
        delivery.status = 'delivered';
        
        // Update subscription last triggered time
        const subscription = this.subscriptions.get(delivery.subscriptionId);
        if (subscription) {
          subscription.lastTriggeredAt = new Date().toISOString();
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${delivery.responseBody}`);
      }
    } catch (error) {
      delivery.status = 'failed';
      delivery.error = error instanceof Error ? error.message : 'Unknown error';

      // Schedule retry if under max attempts
      if (delivery.attempts < this.MAX_ATTEMPTS) {
        const delay = this.RETRY_DELAYS[delivery.attempts - 1] || 60000;
        setTimeout(() => this.attemptDelivery(delivery), delay);
      }
    }

    this.deliveries.set(delivery.id, delivery);
  }

  // ========== Signature Generation ==========

  private async generateSignature(payload: unknown): Promise<string> {
    // In production, use HMAC-SHA256 with a secret key
    // For now, use a simple hash
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));
    
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback for environments without crypto.subtle
      return `sig-${Date.now()}-${Math.random().toString(36).substr(2, 16)}`;
    }
  }

  // ========== Delivery Status ==========

  async getDeliveryStatus(deliveryId: string): Promise<WebhookDelivery | null> {
    return this.deliveries.get(deliveryId) || null;
  }

  async getDeliveriesForSubscription(subscriptionId: string): Promise<WebhookDelivery[]> {
    return Array.from(this.deliveries.values())
      .filter(d => d.subscriptionId === subscriptionId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getFailedDeliveries(): Promise<WebhookDelivery[]> {
    return Array.from(this.deliveries.values())
      .filter(d => d.status === 'failed' && d.attempts >= this.MAX_ATTEMPTS)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ========== Retry Failed Deliveries ==========

  async retryFailedDelivery(deliveryId: string): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    
    if (!delivery || delivery.status !== 'failed') return false;

    delivery.status = 'pending';
    delivery.attempts = 0;
    delivery.error = undefined;
    
    await this.attemptDelivery(delivery);
    return true;
  }

  // ========== Health Check ==========

  async getHealthStatus(): Promise<{
    totalSubscriptions: number;
    activeSubscriptions: number;
    queuedEvents: number;
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    pendingDeliveries: number;
  }> {
    const deliveries = Array.from(this.deliveries.values());
    const subscriptions = Array.from(this.subscriptions.values());

    return {
      totalSubscriptions: subscriptions.length,
      activeSubscriptions: subscriptions.filter(s => s.isActive).length,
      queuedEvents: this.eventQueue.length,
      totalDeliveries: deliveries.length,
      successfulDeliveries: deliveries.filter(d => d.status === 'delivered').length,
      failedDeliveries: deliveries.filter(d => d.status === 'failed').length,
      pendingDeliveries: deliveries.filter(d => d.status === 'pending').length,
    };
  }

  // ========== Event Type Helpers ==========

  static getEventDescription(eventType: WebhookEventType): string {
    const descriptions: Record<WebhookEventType, string> = {
      'inventory.updated': 'Inventory quantity or price has changed',
      'inventory.low_stock': 'Item has fallen below reorder point',
      'inventory.restocked': 'Item has been restocked',
      'shipment.created': 'New shipment has been created',
      'shipment.updated': 'Shipment status has been updated',
      'shipment.delivered': 'Shipment has been delivered',
      'receiving.completed': 'Receiving process has been completed',
      'replenishment.ordered': 'New replenishment order has been placed',
      'replenishment.received': 'Replenishment order has been received',
      'price.changed': 'Card market price has changed significantly',
    };

    return descriptions[eventType] || 'Unknown event type';
  }

  static getAllEventTypes(): WebhookEventType[] {
    return [
      'inventory.updated',
      'inventory.low_stock',
      'inventory.restocked',
      'shipment.created',
      'shipment.updated',
      'shipment.delivered',
      'receiving.completed',
      'replenishment.ordered',
      'replenishment.received',
      'price.changed',
    ];
  }
}

export const webhookService = new WebhookService();
