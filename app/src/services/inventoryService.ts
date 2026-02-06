import type {
  InventoryItem,
  StockLevel,
  Shipment,
  ReceivingEvent,
  ReplenishmentOrder,
  AvailabilitySignal,
  InventoryMetrics,
  InventoryFilter,
} from '@/types';

// Mock database - In production, this would be a real database
class InventoryDatabase {
  private inventory: Map<string, InventoryItem> = new Map();
  private stockLevels: Map<string, StockLevel> = new Map();
  private shipments: Map<string, Shipment> = new Map();
  private receivingEvents: Map<string, ReceivingEvent> = new Map();
  private replenishmentOrders: Map<string, ReplenishmentOrder> = new Map();
  private availabilitySignals: Map<string, AvailabilitySignal> = new Map();

  // Inventory Items
  setInventoryItem(item: InventoryItem): void {
    this.inventory.set(item.id, item);
    this.updateStockLevel(item.cardId, item.storeId, item.quantity);
  }

  getInventoryItem(id: string): InventoryItem | undefined {
    return this.inventory.get(id);
  }

  getAllInventory(): InventoryItem[] {
    return Array.from(this.inventory.values());
  }

  // Stock Levels
  private updateStockLevel(cardId: string, storeId: string, quantity: number): void {
    const key = `${cardId}-${storeId}`;
    const existing = this.stockLevels.get(key);
    
    if (existing) {
      existing.quantity = quantity;
      existing.availableQuantity = quantity - existing.reservedQuantity;
      existing.lastCounted = new Date().toISOString();
    } else {
      this.stockLevels.set(key, {
        cardId,
        storeId,
        quantity,
        reservedQuantity: 0,
        availableQuantity: quantity,
        reorderPoint: 5,
        maxStock: 100,
        lastCounted: new Date().toISOString(),
      });
    }
  }

  getStockLevel(cardId: string, storeId: string): StockLevel | undefined {
    return this.stockLevels.get(`${cardId}-${storeId}`);
  }

  getAllStockLevels(): StockLevel[] {
    return Array.from(this.stockLevels.values());
  }

  // Shipments
  setShipment(shipment: Shipment): void {
    this.shipments.set(shipment.id, shipment);
  }

  getShipment(id: string): Shipment | undefined {
    return this.shipments.get(id);
  }

  getAllShipments(): Shipment[] {
    return Array.from(this.shipments.values());
  }

  // Receiving Events
  setReceivingEvent(event: ReceivingEvent): void {
    this.receivingEvents.set(event.id, event);
  }

  getReceivingEvent(id: string): ReceivingEvent | undefined {
    return this.receivingEvents.get(id);
  }

  getAllReceivingEvents(): ReceivingEvent[] {
    return Array.from(this.receivingEvents.values());
  }

  // Replenishment Orders
  setReplenishmentOrder(order: ReplenishmentOrder): void {
    this.replenishmentOrders.set(order.id, order);
  }

  getReplenishmentOrder(id: string): ReplenishmentOrder | undefined {
    return this.replenishmentOrders.get(id);
  }

  getAllReplenishmentOrders(): ReplenishmentOrder[] {
    return Array.from(this.replenishmentOrders.values());
  }

  // Availability Signals
  setAvailabilitySignal(signal: AvailabilitySignal): void {
    this.availabilitySignals.set(signal.id, signal);
  }

  getAllAvailabilitySignals(): AvailabilitySignal[] {
    return Array.from(this.availabilitySignals.values());
  }
}

const db = new InventoryDatabase();

class InventoryService {
  // ========== Inventory Management ==========

  async getInventory(filter?: InventoryFilter): Promise<InventoryItem[]> {
    let items = db.getAllInventory();

    if (filter) {
      if (filter.storeId) {
        items = items.filter(item => item.storeId === filter.storeId);
      }
      if (filter.cardId) {
        items = items.filter(item => item.cardId === filter.cardId);
      }
      if (filter.game) {
        items = items.filter(item => item.cardId.startsWith(filter.game!));
      }
      if (filter.condition) {
        items = items.filter(item => item.condition === filter.condition);
      }
      if (filter.lowStock) {
        items = items.filter(item => {
          const stock = db.getStockLevel(item.cardId, item.storeId);
          return stock && stock.availableQuantity <= stock.reorderPoint;
        });
      }
      if (filter.inStock) {
        items = items.filter(item => item.quantity > 0);
      }
    }

    return items;
  }

  async getInventoryItem(itemId: string): Promise<InventoryItem | null> {
    return db.getInventoryItem(itemId) || null;
  }

  async updateInventory(item: InventoryItem): Promise<InventoryItem> {
    item.lastUpdated = new Date().toISOString();
    db.setInventoryItem(item);
    return item;
  }

  async adjustStock(
    cardId: string,
    storeId: string,
    adjustment: number,
    reason: string
  ): Promise<StockLevel> {
    const item = db.getAllInventory().find(i => i.cardId === cardId && i.storeId === storeId);
    
    if (item) {
      item.quantity = Math.max(0, item.quantity + adjustment);
      item.lastUpdated = new Date().toISOString();
      item.notes = reason;
      db.setInventoryItem(item);
    }

    return db.getStockLevel(cardId, storeId)!;
  }

  // ========== Stock Level Management ==========

  async getStockLevels(cardId?: string, storeId?: string): Promise<StockLevel[]> {
    let levels = db.getAllStockLevels();

    if (cardId) {
      levels = levels.filter(level => level.cardId === cardId);
    }
    if (storeId) {
      levels = levels.filter(level => level.storeId === storeId);
    }

    return levels;
  }

  async getLowStockItems(): Promise<StockLevel[]> {
    return db.getAllStockLevels().filter(level => 
      level.availableQuantity <= level.reorderPoint
    );
  }

  async setReorderPoint(cardId: string, storeId: string, reorderPoint: number): Promise<StockLevel> {
    const level = db.getAllStockLevels().find(l => l.cardId === cardId && l.storeId === storeId);
    
    if (level) {
      level.reorderPoint = reorderPoint;
    }

    return level!;
  }

  // ========== Shipment Tracking ==========

  async createShipment(shipment: Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Shipment> {
    const newShipment: Shipment = {
      ...shipment,
      id: `ship-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.setShipment(newShipment);
    return newShipment;
  }

  async getShipment(shipmentId: string): Promise<Shipment | null> {
    return db.getShipment(shipmentId) || null;
  }

  async getShipments(filter?: {
    storeId?: string;
    status?: string;
    carrier?: string;
  }): Promise<Shipment[]> {
    let shipments = db.getAllShipments();

    if (filter) {
      if (filter.storeId) {
        shipments = shipments.filter(s => s.destinationStoreId === filter.storeId);
      }
      if (filter.status) {
        shipments = shipments.filter(s => s.status === filter.status);
      }
      if (filter.carrier) {
        shipments = shipments.filter(s => s.carrier === filter.carrier);
      }
    }

    return shipments.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async updateShipmentStatus(
    shipmentId: string,
    status: Shipment['status'],
    event?: string
  ): Promise<Shipment | null> {
    const shipment = db.getShipment(shipmentId);
    
    if (!shipment) return null;

    shipment.status = status;
    shipment.lastEvent = event;
    shipment.lastEventAt = new Date().toISOString();
    shipment.updatedAt = new Date().toISOString();

    if (status === 'delivered') {
      shipment.deliveredAt = new Date().toISOString();
    }

    db.setShipment(shipment);
    return shipment;
  }

  async trackShipment(carrier: string, trackingNumber: string): Promise<Partial<Shipment> | null> {
    // In production, this would integrate with carrier APIs
    // For now, return mock tracking data
    return {
      carrier: carrier as Shipment['carrier'],
      trackingNumber,
      status: 'in_transit',
      lastEvent: 'Arrived at regional facility',
      lastEventAt: new Date().toISOString(),
      eta: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  // ========== Receiving Management ==========

  async createReceivingEvent(
    event: Omit<ReceivingEvent, 'id' | 'receivedAt'>
  ): Promise<ReceivingEvent> {
    const newEvent: ReceivingEvent = {
      ...event,
      id: `recv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      receivedAt: new Date().toISOString(),
    };

    db.setReceivingEvent(newEvent);

    // Update inventory based on received items
    for (const item of event.items) {
      await this.adjustStock(
        item.cardId,
        event.storeId,
        item.quantityReceived,
        `Received from ${event.shipmentId || 'direct delivery'}`
      );
    }

    return newEvent;
  }

  async getReceivingEvents(filter?: {
    storeId?: string;
    shipmentId?: string;
  }): Promise<ReceivingEvent[]> {
    let events = db.getAllReceivingEvents();

    if (filter) {
      if (filter.storeId) {
        events = events.filter(e => e.storeId === filter.storeId);
      }
      if (filter.shipmentId) {
        events = events.filter(e => e.shipmentId === filter.shipmentId);
      }
    }

    return events.sort((a, b) => 
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    );
  }

  // ========== Replenishment Management ==========

  async createReplenishmentOrder(
    order: Omit<ReplenishmentOrder, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ReplenishmentOrder> {
    const newOrder: ReplenishmentOrder = {
      ...order,
      id: `repl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.setReplenishmentOrder(newOrder);
    return newOrder;
  }

  async getReplenishmentOrder(orderId: string): Promise<ReplenishmentOrder | null> {
    return db.getReplenishmentOrder(orderId) || null;
  }

  async getReplenishmentOrders(filter?: {
    storeId?: string;
    status?: string;
  }): Promise<ReplenishmentOrder[]> {
    let orders = db.getAllReplenishmentOrders();

    if (filter) {
      if (filter.storeId) {
        orders = orders.filter(o => o.storeId === filter.storeId);
      }
      if (filter.status) {
        orders = orders.filter(o => o.status === filter.status);
      }
    }

    return orders.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async updateReplenishmentStatus(
    orderId: string,
    status: ReplenishmentOrder['status'],
    updates?: Partial<ReplenishmentOrder>
  ): Promise<ReplenishmentOrder | null> {
    const order = db.getReplenishmentOrder(orderId);
    
    if (!order) return null;

    order.status = status;
    order.updatedAt = new Date().toISOString();

    if (updates) {
      Object.assign(order, updates);
    }

    // If received, create receiving event
    if (status === 'received') {
      order.receivedAt = new Date().toISOString();
      
      const receivedItems = order.items
        .filter(item => item.quantityReceived && item.quantityReceived > 0)
        .map(item => ({
          cardId: item.cardId,
          cardName: item.cardName,
          quantityReceived: item.quantityReceived!,
          quantityExpected: item.quantityOrdered,
          condition: 'sealed',
          unitCost: item.unitCost,
          totalCost: item.unitCost * item.quantityReceived!,
        }));

      if (receivedItems.length > 0) {
        await this.createReceivingEvent({
          shipmentId: order.id,
          storeId: order.storeId,
          receivedBy: 'system',
          items: receivedItems,
          source: 'replenishment',
        });
      }
    }

    db.setReplenishmentOrder(order);
    return order;
  }

  // ========== Availability Signals ==========

  async recordAvailabilitySignal(
    signal: Omit<AvailabilitySignal, 'id' | 'observedAt'>
  ): Promise<AvailabilitySignal> {
    const newSignal: AvailabilitySignal = {
      ...signal,
      id: `sig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      observedAt: new Date().toISOString(),
    };

    db.setAvailabilitySignal(newSignal);
    return newSignal;
  }

  async getAvailabilitySignals(filter?: {
    cardId?: string;
    storeId?: string;
    signalType?: string;
  }): Promise<AvailabilitySignal[]> {
    let signals = db.getAllAvailabilitySignals();

    if (filter) {
      if (filter.cardId) {
        signals = signals.filter(s => s.cardId === filter.cardId);
      }
      if (filter.storeId) {
        signals = signals.filter(s => s.storeId === filter.storeId);
      }
      if (filter.signalType) {
        signals = signals.filter(s => s.signalType === filter.signalType);
      }
    }

    return signals.sort((a, b) => 
      new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
    );
  }

  // ========== Metrics & Analytics ==========

  async getMetrics(): Promise<InventoryMetrics> {
    const inventory = db.getAllInventory();
    const stockLevels = db.getAllStockLevels();
    const shipments = db.getAllShipments();
    const receivingEvents = db.getAllReceivingEvents();

    const totalValue = inventory.reduce((sum, item) => 
      sum + (item.price * item.quantity), 0
    );

    const lowStockCount = stockLevels.filter(level => 
      level.availableQuantity <= level.reorderPoint
    ).length;

    const outOfStockCount = stockLevels.filter(level => 
      level.availableQuantity === 0
    ).length;

    const recentRestocks = receivingEvents.filter(event => {
      const eventDate = new Date(event.receivedAt);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return eventDate >= sevenDaysAgo;
    }).length;

    const pendingShipments = shipments.filter(s => 
      ['pending', 'label_created', 'picked_up', 'in_transit', 'out_for_delivery'].includes(s.status)
    ).length;

    const pendingReceiving = shipments.filter(s => 
      s.status === 'delivered' && !receivingEvents.some(e => e.shipmentId === s.id)
    ).length;

    return {
      totalCards: inventory.reduce((sum, item) => sum + item.quantity, 0),
      totalValue,
      lowStockCount,
      outOfStockCount,
      recentRestocks,
      pendingShipments,
      pendingReceiving,
    };
  }

  // ========== Auto-Replenishment ==========

  async generateReplenishmentSuggestions(storeId: string): Promise<Array<{
    cardId: string;
    cardName: string;
    currentStock: number;
    reorderPoint: number;
    suggestedOrder: number;
    priority: 'high' | 'medium' | 'low';
  }>> {
    const stockLevels = await this.getStockLevels(undefined, storeId);
    const suggestions: Array<{
      cardId: string;
      cardName: string;
      currentStock: number;
      reorderPoint: number;
      suggestedOrder: number;
      priority: 'high' | 'medium' | 'low';
    }> = [];

    for (const level of stockLevels) {
      if (level.availableQuantity <= level.reorderPoint) {
        const inventoryItem = db.getAllInventory().find(
          i => i.cardId === level.cardId && i.storeId === storeId
        );

        const shortage = level.maxStock - level.availableQuantity;
        const suggestedOrder = Math.min(shortage, 50); // Cap at 50 units

        suggestions.push({
          cardId: level.cardId,
          cardName: inventoryItem?.cardName || level.cardId,
          currentStock: level.availableQuantity,
          reorderPoint: level.reorderPoint,
          suggestedOrder,
          priority: level.availableQuantity === 0 ? 'high' : 'medium',
        });
      }
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }
}

export const inventoryService = new InventoryService();
