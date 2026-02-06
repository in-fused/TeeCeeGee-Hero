import { useState, useEffect, useCallback } from 'react';
import { inventoryService } from '@/services/inventoryService';
import type {
  InventoryItem,
  StockLevel,
  Shipment,
  ReceivingEvent,
  ReplenishmentOrder,
  AvailabilitySignal,
  InventoryMetrics,
  InventoryFilter,
  ShipmentStatus,
  ReplenishmentStatus,
} from '@/types';

// ========== useInventory Hook ==========

interface UseInventoryOptions {
  filter?: InventoryFilter;
  autoLoad?: boolean;
}

interface UseInventoryReturn {
  inventory: InventoryItem[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  updateItem: (item: InventoryItem) => Promise<InventoryItem>;
  adjustStock: (cardId: string, storeId: string, adjustment: number, reason: string) => Promise<StockLevel>;
}

export function useInventory(options: UseInventoryOptions = {}): UseInventoryReturn {
  const { filter, autoLoad = true } = options;
  
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const items = await inventoryService.getInventory(filter);
      setInventory(items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch inventory'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (autoLoad) {
      fetchInventory();
    }
  }, [fetchInventory, autoLoad]);

  const updateItem = useCallback(async (item: InventoryItem): Promise<InventoryItem> => {
    const updated = await inventoryService.updateInventory(item);
    await fetchInventory();
    return updated;
  }, [fetchInventory]);

  const adjustStock = useCallback(async (
    cardId: string,
    storeId: string,
    adjustment: number,
    reason: string
  ): Promise<StockLevel> => {
    const result = await inventoryService.adjustStock(cardId, storeId, adjustment, reason);
    await fetchInventory();
    return result;
  }, [fetchInventory]);

  return {
    inventory,
    loading,
    error,
    refresh: fetchInventory,
    updateItem,
    adjustStock,
  };
}

// ========== useStockLevels Hook ==========

interface UseStockLevelsOptions {
  cardId?: string;
  storeId?: string;
  autoLoad?: boolean;
}

interface UseStockLevelsReturn {
  stockLevels: StockLevel[];
  lowStockItems: StockLevel[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  setReorderPoint: (cardId: string, storeId: string, reorderPoint: number) => Promise<StockLevel>;
}

export function useStockLevels(options: UseStockLevelsOptions = {}): UseStockLevelsReturn {
  const { cardId, storeId, autoLoad = true } = options;
  
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [lowStockItems, setLowStockItems] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchStockLevels = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [levels, lowStock] = await Promise.all([
        inventoryService.getStockLevels(cardId, storeId),
        inventoryService.getLowStockItems(),
      ]);
      setStockLevels(levels);
      setLowStockItems(lowStock);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch stock levels'));
    } finally {
      setLoading(false);
    }
  }, [cardId, storeId]);

  useEffect(() => {
    if (autoLoad) {
      fetchStockLevels();
    }
  }, [fetchStockLevels, autoLoad]);

  const setReorderPoint = useCallback(async (
    cid: string,
    sid: string,
    reorderPoint: number
  ): Promise<StockLevel> => {
    const result = await inventoryService.setReorderPoint(cid, sid, reorderPoint);
    await fetchStockLevels();
    return result;
  }, [fetchStockLevels]);

  return {
    stockLevels,
    lowStockItems,
    loading,
    error,
    refresh: fetchStockLevels,
    setReorderPoint,
  };
}

// ========== useShipments Hook ==========

interface UseShipmentsOptions {
  storeId?: string;
  status?: ShipmentStatus;
  carrier?: string;
  autoLoad?: boolean;
}

interface UseShipmentsReturn {
  shipments: Shipment[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  createShipment: (shipment: Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Shipment>;
  updateStatus: (shipmentId: string, status: ShipmentStatus, event?: string) => Promise<Shipment | null>;
  trackShipment: (carrier: string, trackingNumber: string) => Promise<Partial<Shipment> | null>;
}

export function useShipments(options: UseShipmentsOptions = {}): UseShipmentsReturn {
  const { storeId, status, carrier, autoLoad = true } = options;
  
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchShipments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const items = await inventoryService.getShipments({ storeId, status, carrier });
      setShipments(items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch shipments'));
    } finally {
      setLoading(false);
    }
  }, [storeId, status, carrier]);

  useEffect(() => {
    if (autoLoad) {
      fetchShipments();
    }
  }, [fetchShipments, autoLoad]);

  const createShipment = useCallback(async (
    shipment: Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Shipment> => {
    const created = await inventoryService.createShipment(shipment);
    await fetchShipments();
    return created;
  }, [fetchShipments]);

  const updateStatus = useCallback(async (
    shipmentId: string,
    newStatus: ShipmentStatus,
    event?: string
  ): Promise<Shipment | null> => {
    const updated = await inventoryService.updateShipmentStatus(shipmentId, newStatus, event);
    await fetchShipments();
    return updated;
  }, [fetchShipments]);

  const trackShipment = useCallback(async (
    carrier: string,
    trackingNumber: string
  ): Promise<Partial<Shipment> | null> => {
    return inventoryService.trackShipment(carrier, trackingNumber);
  }, []);

  return {
    shipments,
    loading,
    error,
    refresh: fetchShipments,
    createShipment,
    updateStatus,
    trackShipment,
  };
}

// ========== useReceiving Hook ==========

interface UseReceivingOptions {
  storeId?: string;
  shipmentId?: string;
  autoLoad?: boolean;
}

interface UseReceivingReturn {
  receivingEvents: ReceivingEvent[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  createReceivingEvent: (event: Omit<ReceivingEvent, 'id' | 'receivedAt'>) => Promise<ReceivingEvent>;
}

export function useReceiving(options: UseReceivingOptions = {}): UseReceivingReturn {
  const { storeId, shipmentId, autoLoad = true } = options;
  
  const [receivingEvents, setReceivingEvents] = useState<ReceivingEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchReceivingEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const events = await inventoryService.getReceivingEvents({ storeId, shipmentId });
      setReceivingEvents(events);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch receiving events'));
    } finally {
      setLoading(false);
    }
  }, [storeId, shipmentId]);

  useEffect(() => {
    if (autoLoad) {
      fetchReceivingEvents();
    }
  }, [fetchReceivingEvents, autoLoad]);

  const createReceivingEvent = useCallback(async (
    event: Omit<ReceivingEvent, 'id' | 'receivedAt'>
  ): Promise<ReceivingEvent> => {
    const created = await inventoryService.createReceivingEvent(event);
    await fetchReceivingEvents();
    return created;
  }, [fetchReceivingEvents]);

  return {
    receivingEvents,
    loading,
    error,
    refresh: fetchReceivingEvents,
    createReceivingEvent,
  };
}

// ========== useReplenishment Hook ==========

interface UseReplenishmentOptions {
  storeId?: string;
  status?: ReplenishmentStatus;
  autoLoad?: boolean;
}

interface UseReplenishmentReturn {
  orders: ReplenishmentOrder[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  createOrder: (order: Omit<ReplenishmentOrder, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ReplenishmentOrder>;
  updateStatus: (orderId: string, status: ReplenishmentStatus, updates?: Partial<ReplenishmentOrder>) => Promise<ReplenishmentOrder | null>;
  getSuggestions: (storeId: string) => Promise<Array<{
    cardId: string;
    cardName: string;
    currentStock: number;
    reorderPoint: number;
    suggestedOrder: number;
    priority: 'high' | 'medium' | 'low';
  }>>;
}

export function useReplenishment(options: UseReplenishmentOptions = {}): UseReplenishmentReturn {
  const { storeId, status, autoLoad = true } = options;
  
  const [orders, setOrders] = useState<ReplenishmentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const items = await inventoryService.getReplenishmentOrders({ storeId, status });
      setOrders(items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch replenishment orders'));
    } finally {
      setLoading(false);
    }
  }, [storeId, status]);

  useEffect(() => {
    if (autoLoad) {
      fetchOrders();
    }
  }, [fetchOrders, autoLoad]);

  const createOrder = useCallback(async (
    order: Omit<ReplenishmentOrder, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ReplenishmentOrder> => {
    const created = await inventoryService.createReplenishmentOrder(order);
    await fetchOrders();
    return created;
  }, [fetchOrders]);

  const updateStatus = useCallback(async (
    orderId: string,
    newStatus: ReplenishmentStatus,
    updates?: Partial<ReplenishmentOrder>
  ): Promise<ReplenishmentOrder | null> => {
    const updated = await inventoryService.updateReplenishmentStatus(orderId, newStatus, updates);
    await fetchOrders();
    return updated;
  }, [fetchOrders]);

  const getSuggestions = useCallback(async (sid: string) => {
    return inventoryService.generateReplenishmentSuggestions(sid);
  }, []);

  return {
    orders,
    loading,
    error,
    refresh: fetchOrders,
    createOrder,
    updateStatus,
    getSuggestions,
  };
}

// ========== useAvailabilitySignals Hook ==========

interface UseAvailabilitySignalsOptions {
  cardId?: string;
  storeId?: string;
  signalType?: AvailabilitySignal['signalType'];
  autoLoad?: boolean;
}

interface UseAvailabilitySignalsReturn {
  signals: AvailabilitySignal[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  recordSignal: (signal: Omit<AvailabilitySignal, 'id' | 'observedAt'>) => Promise<AvailabilitySignal>;
}

export function useAvailabilitySignals(options: UseAvailabilitySignalsOptions = {}): UseAvailabilitySignalsReturn {
  const { cardId, storeId, signalType, autoLoad = true } = options;
  
  const [signals, setSignals] = useState<AvailabilitySignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const items = await inventoryService.getAvailabilitySignals({ cardId, storeId, signalType });
      setSignals(items);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch availability signals'));
    } finally {
      setLoading(false);
    }
  }, [cardId, storeId, signalType]);

  useEffect(() => {
    if (autoLoad) {
      fetchSignals();
    }
  }, [fetchSignals, autoLoad]);

  const recordSignal = useCallback(async (
    signal: Omit<AvailabilitySignal, 'id' | 'observedAt'>
  ): Promise<AvailabilitySignal> => {
    const created = await inventoryService.recordAvailabilitySignal(signal);
    await fetchSignals();
    return created;
  }, [fetchSignals]);

  return {
    signals,
    loading,
    error,
    refresh: fetchSignals,
    recordSignal,
  };
}

// ========== useInventoryMetrics Hook ==========

interface UseInventoryMetricsReturn {
  metrics: InventoryMetrics | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useInventoryMetrics(): UseInventoryMetricsReturn {
  const [metrics, setMetrics] = useState<InventoryMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await inventoryService.getMetrics();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch metrics'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return {
    metrics,
    loading,
    error,
    refresh: fetchMetrics,
  };
}
