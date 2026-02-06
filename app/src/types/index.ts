// Card Types
export interface Card {
  id: string;
  tcgplayerId?: number;
  name: string;
  setName: string;
  game: 'pokemon' | 'one_piece';
  cardType?: string;
  rarity?: string;
  number?: string;
  imageUrl?: string;
  marketPrice?: number;
  msrp?: number;
  releaseDate?: string;
  language: 'ENG' | 'JPN';
  lastUpdated: string;
}

export interface PokemonCard extends Card {
  game: 'pokemon';
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  attacks?: PokemonAttack[];
  weaknesses?: PokemonWeakness[];
  resistances?: PokemonResistance[];
  retreatCost?: string[];
  convertedRetreatCost?: number;
  artist?: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  legalities?: PokemonLegalities;
}

export interface PokemonAttack {
  name: string;
  cost: string[];
  convertedEnergyCost: number;
  damage: string;
  text: string;
}

export interface PokemonWeakness {
  type: string;
  value: string;
}

export interface PokemonResistance {
  type: string;
  value: string;
}

export interface PokemonLegalities {
  unlimited?: string;
  standard?: string;
  expanded?: string;
}

export interface OnePieceCard extends Card {
  game: 'one_piece';
  cardType: 'LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE' | 'DON';
  color: string[];
  power?: number;
  counter?: number;
  life?: number;
  cost?: number;
  attribute?: string;
  effect?: string;
  trigger?: string;
  block?: string;
}

// Inventory Types
export interface InventoryItem {
  id: string;
  cardId: string;
  cardName?: string;
  storeId: string;
  storeName: string;
  quantity: number;
  condition: 'sealed' | 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';
  price: number;
  currency: string;
  lastRestocked?: string;
  lastUpdated: string;
  source: string;
  notes?: string;
}

export interface StockLevel {
  cardId: string;
  storeId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderPoint: number;
  maxStock: number;
  lastCounted: string;
}

// Delivery/Receiving Types
export interface Shipment {
  id: string;
  carrier: 'USPS' | 'UPS' | 'FedEx' | 'DHL' | 'other';
  trackingNumber: string;
  originZip?: string;
  destinationZip: string;
  destinationStoreId: string;
  status: ShipmentStatus;
  eta?: string;
  shippedAt?: string;
  deliveredAt?: string;
  lastEvent?: string;
  lastEventAt?: string;
  items: ShipmentItem[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

export type ShipmentStatus = 
  | 'pending'
  | 'label_created'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned'
  | 'unknown';

export interface ShipmentItem {
  cardId: string;
  cardName: string;
  quantity: number;
  condition: string;
  expectedPrice: number;
}

export interface ReceivingEvent {
  id: string;
  shipmentId?: string;
  storeId: string;
  receivedAt: string;
  receivedBy: string;
  items: ReceivedItem[];
  notes?: string;
  source: string;
}

export interface ReceivedItem {
  cardId: string;
  cardName: string;
  quantityReceived: number;
  quantityExpected?: number;
  condition: string;
  unitCost: number;
  totalCost: number;
  discrepancies?: string;
}

// Replenishment Types
export interface ReplenishmentOrder {
  id: string;
  storeId: string;
  supplierId?: string;
  status: ReplenishmentStatus;
  items: ReplenishmentItem[];
  totalCost: number;
  orderedAt?: string;
  expectedDelivery?: string;
  receivedAt?: string;
  createdAt: string;
  updatedAt: string;
  source: string;
}

export type ReplenishmentStatus = 
  | 'draft'
  | 'pending_approval'
  | 'ordered'
  | 'partially_shipped'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface ReplenishmentItem {
  cardId: string;
  cardName: string;
  quantityOrdered: number;
  quantityReceived?: number;
  unitCost: number;
  totalCost: number;
  supplierSku?: string;
}

// Availability Signal Types
export interface AvailabilitySignal {
  id: string;
  cardId: string;
  storeId?: string;
  storeName?: string;
  signalType: 'in_stock' | 'out_of_stock' | 'low_stock' | 'restocked' | 'price_drop' | 'price_increase';
  confidence: number;
  price?: number;
  quantity?: number;
  source: string;
  rawData?: Record<string, unknown>;
  observedAt: string;
}

// Store Types
export interface Store {
  id: string;
  name: string;
  storeType: 'big_box' | 'lgs' | 'vending' | 'online' | 'unknown';
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  website?: string;
  hours?: StoreHours;
  source: string;
  retrievedAt: string;
}

export interface StoreHours {
  monday?: string;
  tuesday?: string;
  wednesday?: string;
  thursday?: string;
  friday?: string;
  saturday?: string;
  sunday?: string;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    hasMore?: boolean;
  };
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Webhook Types
export interface WebhookEvent {
  id: string;
  eventType: WebhookEventType;
  payload: unknown;
  timestamp: string;
  signature: string;
}

export type WebhookEventType = 
  | 'inventory.updated'
  | 'inventory.low_stock'
  | 'inventory.restocked'
  | 'shipment.created'
  | 'shipment.updated'
  | 'shipment.delivered'
  | 'receiving.completed'
  | 'replenishment.ordered'
  | 'replenishment.received'
  | 'price.changed';

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEventType[];
  secret: string;
  isActive: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
}

// Filter Types
export interface CardFilter {
  game?: 'pokemon' | 'one_piece';
  setName?: string;
  rarity?: string;
  cardType?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  search?: string;
}

export interface InventoryFilter {
  storeId?: string;
  cardId?: string;
  game?: 'pokemon' | 'one_piece';
  condition?: string;
  lowStock?: boolean;
  inStock?: boolean;
}

// Dashboard Types
export interface InventoryMetrics {
  totalCards: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  recentRestocks: number;
  pendingShipments: number;
  pendingReceiving: number;
}

export interface PriceHistory {
  cardId: string;
  date: string;
  price: number;
  source: string;
}
