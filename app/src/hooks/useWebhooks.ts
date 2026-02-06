import { useState, useEffect, useCallback } from 'react';
import { webhookService } from '@/services/webhookService';
import type { WebhookSubscription, WebhookEventType } from '@/types';

// ========== useWebhooks Hook ==========

interface UseWebhooksReturn {
  subscriptions: WebhookSubscription[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  createSubscription: (url: string, events: WebhookEventType[], secret: string) => Promise<WebhookSubscription>;
  updateSubscription: (id: string, updates: Partial<Omit<WebhookSubscription, 'id' | 'createdAt'>>) => Promise<WebhookSubscription | null>;
  deleteSubscription: (id: string) => Promise<boolean>;
}

export function useWebhooks(): UseWebhooksReturn {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const items = await webhookService.getAllSubscriptions();
      setSubscriptions(items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch webhooks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const createSubscription = useCallback(async (
    url: string,
    events: WebhookEventType[],
    secret: string
  ): Promise<WebhookSubscription> => {
    const created = await webhookService.createSubscription(url, events, secret);
    await fetchSubscriptions();
    return created;
  }, [fetchSubscriptions]);

  const updateSubscription = useCallback(async (
    id: string,
    updates: Partial<Omit<WebhookSubscription, 'id' | 'createdAt'>>
  ): Promise<WebhookSubscription | null> => {
    const updated = await webhookService.updateSubscription(id, updates);
    await fetchSubscriptions();
    return updated;
  }, [fetchSubscriptions]);

  const deleteSubscription = useCallback(async (id: string): Promise<boolean> => {
    const deleted = await webhookService.deleteSubscription(id);
    if (deleted) {
      await fetchSubscriptions();
    }
    return deleted;
  }, [fetchSubscriptions]);

  return {
    subscriptions,
    loading,
    error,
    refresh: fetchSubscriptions,
    createSubscription,
    updateSubscription,
    deleteSubscription,
  };
}

// ========== useWebhookHealth Hook ==========

interface WebhookHealthStatus {
  totalSubscriptions: number;
  activeSubscriptions: number;
  queuedEvents: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  pendingDeliveries: number;
}

interface UseWebhookHealthReturn {
  health: WebhookHealthStatus | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useWebhookHealth(): UseWebhookHealthReturn {
  const [health, setHealth] = useState<WebhookHealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await webhookService.getHealthStatus();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch webhook health'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return {
    health,
    loading,
    error,
    refresh: fetchHealth,
  };
}

// ========== useWebhookDeliveries Hook ==========

interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt?: string;
  responseStatus?: number;
  error?: string;
  createdAt: string;
}

interface UseWebhookDeliveriesOptions {
  subscriptionId?: string;
  showFailedOnly?: boolean;
}

interface UseWebhookDeliveriesReturn {
  deliveries: WebhookDelivery[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  retryDelivery: (deliveryId: string) => Promise<boolean>;
}

export function useWebhookDeliveries(options: UseWebhookDeliveriesOptions = {}): UseWebhookDeliveriesReturn {
  const { subscriptionId, showFailedOnly = false } = options;
  
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchDeliveries = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let items: WebhookDelivery[];
      
      if (showFailedOnly) {
        items = await webhookService.getFailedDeliveries() as WebhookDelivery[];
      } else if (subscriptionId) {
        items = await webhookService.getDeliveriesForSubscription(subscriptionId) as WebhookDelivery[];
      } else {
        items = [];
      }
      
      setDeliveries(items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch deliveries'));
    } finally {
      setLoading(false);
    }
  }, [subscriptionId, showFailedOnly]);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  const retryDelivery = useCallback(async (deliveryId: string): Promise<boolean> => {
    const success = await webhookService.retryFailedDelivery(deliveryId);
    if (success) {
      await fetchDeliveries();
    }
    return success;
  }, [fetchDeliveries]);

  return {
    deliveries,
    loading,
    error,
    refresh: fetchDeliveries,
    retryDelivery,
  };
}

// ========== useEventTypes Hook ==========

interface EventTypeInfo {
  type: WebhookEventType;
  description: string;
  category: 'inventory' | 'shipment' | 'receiving' | 'replenishment' | 'price';
}

interface UseEventTypesReturn {
  eventTypes: EventTypeInfo[];
  categories: string[];
  getByCategory: (category: string) => EventTypeInfo[];
}

export function useEventTypes(): UseEventTypesReturn {
  const eventTypes: EventTypeInfo[] = [
    { type: 'inventory.updated', description: 'Inventory quantity or price has changed', category: 'inventory' },
    { type: 'inventory.low_stock', description: 'Item has fallen below reorder point', category: 'inventory' },
    { type: 'inventory.restocked', description: 'Item has been restocked', category: 'inventory' },
    { type: 'shipment.created', description: 'New shipment has been created', category: 'shipment' },
    { type: 'shipment.updated', description: 'Shipment status has been updated', category: 'shipment' },
    { type: 'shipment.delivered', description: 'Shipment has been delivered', category: 'shipment' },
    { type: 'receiving.completed', description: 'Receiving process has been completed', category: 'receiving' },
    { type: 'replenishment.ordered', description: 'New replenishment order has been placed', category: 'replenishment' },
    { type: 'replenishment.received', description: 'Replenishment order has been received', category: 'replenishment' },
    { type: 'price.changed', description: 'Card market price has changed significantly', category: 'price' },
  ];

  const categories = Array.from(new Set(eventTypes.map(e => e.category)));

  const getByCategory = useCallback((category: string) => {
    return eventTypes.filter(e => e.category === category);
  }, [eventTypes]);

  return {
    eventTypes,
    categories,
    getByCategory,
  };
}

// ========== useRealtimeUpdates Hook ==========

interface UseRealtimeUpdatesOptions {
  onEvent?: (event: { type: WebhookEventType; payload: unknown }) => void;
  enabled?: boolean;
}

interface UseRealtimeUpdatesReturn {
  isConnected: boolean;
  lastEvent: { type: WebhookEventType; payload: unknown } | null;
  connect: () => void;
  disconnect: () => void;
}

export function useRealtimeUpdates(options: UseRealtimeUpdatesOptions = {}): UseRealtimeUpdatesReturn {
  const { onEvent: _onEvent, enabled = true } = options;
  
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, _setLastEvent] = useState<{ type: WebhookEventType; payload: unknown } | null>(null);

  // Simulate WebSocket connection for real-time updates
  // In production, this would use a real WebSocket or SSE connection
  const connect = useCallback(() => {
    setIsConnected(true);
    
    // Simulate receiving events
    const interval = setInterval(() => {
      // This would be replaced with actual WebSocket message handling
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const disconnect = useCallback(() => {
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      const cleanup = connect();
      return cleanup;
    }
  }, [enabled, connect]);

  return {
    isConnected,
    lastEvent,
    connect,
    disconnect,
  };
}
