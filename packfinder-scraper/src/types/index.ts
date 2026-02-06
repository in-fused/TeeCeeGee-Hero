/**
 * Type definitions for scraped TCG data
 */

// ============================================================================
// Card Types
// ============================================================================

export type GameType = 'pokemon' | 'one_piece' | 'yugioh' | 'mtg' | 'other';
export type ProductType = 'booster_box' | 'booster_pack' | 'etb' | 'tin' | 'collection_box' | 'single' | 'bundle' | 'other';
export type Condition = 'sealed' | 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';
export type ListingStatus = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'discontinued';

// ============================================================================
// Scraped Listing
// ============================================================================

export interface ScrapedListing {
  id?: string;
  externalId: string;
  retailer: string;
  productUrl: string;
  
  // Card/Product info
  name: string;
  game: GameType;
  productType: ProductType;
  setName?: string;
  setCode?: string;
  cardNumber?: string;
  rarity?: string;
  condition: Condition;
  language?: string;
  
  // Pricing
  price: number;
  currency: string;
  msrp?: number;
  discount?: number;
  
  // Availability
  status: ListingStatus;
  quantity?: number;
  
  // Media
  imageUrl?: string;
  
  // Metadata
  scrapedAt: Date;
  updatedAt: Date;
  rawData?: Record<string, unknown>;
}

// ============================================================================
// Inventory Tracking
// ============================================================================

export interface InventorySnapshot {
  id?: string;
  listingId: string;
  retailer: string;
  quantity: number;
  status: ListingStatus;
  price: number;
  snapshotAt: Date;
}

export interface InventoryChange {
  id?: string;
  listingId: string;
  retailer: string;
  changeType: 'price_change' | 'stock_change' | 'status_change' | 'new_listing' | 'removed';
  oldValue: unknown;
  newValue: unknown;
  detectedAt: Date;
}

// ============================================================================
// Price Tracking
// ============================================================================

export interface PricePoint {
  id?: string;
  listingId: string;
  retailer: string;
  price: number;
  currency: string;
  recordedAt: Date;
}

export interface PriceAlert {
  id?: string;
  listingId: string;
  alertType: 'below_threshold' | 'above_threshold' | 'drop_percentage' | 'restocked';
  threshold: number;
  triggered: boolean;
  triggeredAt?: Date;
  createdAt: Date;
}

// ============================================================================
// Replenishment
// ============================================================================

export interface ReplenishmentNeed {
  id?: string;
  productName: string;
  game: GameType;
  setName?: string;
  
  // Current state
  currentStock: number;
  desiredStock: number;
  shortage: number;
  
  // Sourcing
  bestPrice?: number;
  bestRetailer?: string;
  alternatives: Array<{
    retailer: string;
    price: number;
    quantity: number;
    url: string;
  }>;
  
  // Priority
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  
  createdAt: Date;
}

export interface PurchaseOrder {
  id?: string;
  status: 'draft' | 'pending' | 'ordered' | 'shipped' | 'received' | 'cancelled';
  retailer: string;
  items: Array<{
    listingId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
  
  // Tracking
  orderNumber?: string;
  trackingNumber?: string;
  
  // Dates
  createdAt: Date;
  orderedAt?: Date;
  expectedDelivery?: Date;
  receivedAt?: Date;
}

// ============================================================================
// Webhook Events
// ============================================================================

export type WebhookEventType = 
  | 'listing.new'
  | 'listing.updated'
  | 'listing.removed'
  | 'price.drop'
  | 'price.increase'
  | 'stock.in'
  | 'stock.out'
  | 'restocked'
  | 'replenishment.needed';

export interface WebhookPayload {
  eventType: WebhookEventType;
  timestamp: Date;
  data: unknown;
}

// ============================================================================
// Retailer Config
// ============================================================================

export interface RetailerConfig {
  name: string;
  baseUrl: string;
  enabled: boolean;
  rateLimitMs: number;
  
  // Scraping config
  selectors: {
    productName: string;
    price: string;
    availability: string;
    image?: string;
    setName?: string;
    cardNumber?: string;
    rarity?: string;
  };
  
  // API config (if available)
  apiConfig?: {
    endpoint: string;
    authType: 'none' | 'api_key' | 'oauth';
    apiKey?: string;
  };
  
  // Search endpoints
  searchEndpoints: Array<{
    game: GameType;
    url: string;
    params: Record<string, string>;
  }>;
}

// ============================================================================
// Scraping Job
// ============================================================================

export interface ScrapingJob {
  id?: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  retailer: string;
  game?: GameType;
  
  // Progress
  totalUrls: number;
  processedUrls: number;
  successfulScrapes: number;
  failedScrapes: number;
  
  // Timing
  startedAt?: Date;
  completedAt?: Date;
  
  // Results
  newListings: number;
  updatedListings: number;
  errors: Array<{
    url: string;
    error: string;
    timestamp: Date;
  }>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    hasMore?: boolean;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
