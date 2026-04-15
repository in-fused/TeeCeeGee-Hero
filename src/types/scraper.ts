/**
 * Type definitions for the PackFinder scraper module.
 * Uses string literals instead of DB enums to avoid migration conflicts
 * with the existing game_type / product_type enums.
 */

export type ScraperGameType = 'pokemon' | 'one_piece' | 'yugioh' | 'mtg' | 'other';
export type ScraperProductType =
  | 'booster_box'
  | 'booster_pack'
  | 'etb'
  | 'tin'
  | 'collection_box'
  | 'single'
  | 'bundle'
  | 'blister'
  | 'other';
export type Condition = 'sealed' | 'nm' | 'lp' | 'mp' | 'hp' | 'damaged';
export type ListingStatus = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'discontinued';

export interface ScrapedListing {
  id?: string;
  externalId: string;
  retailer: string;
  productUrl: string;
  name: string;
  game: ScraperGameType;
  productType: ScraperProductType;
  setName?: string;
  setCode?: string;
  cardNumber?: string;
  rarity?: string;
  condition: Condition;
  language?: string;
  price: number;
  currency: string;
  msrp?: number;
  discount?: number;
  status: ListingStatus;
  quantity?: number;
  imageUrl?: string;
  scrapedAt: Date;
  updatedAt: Date;
  rawData?: Record<string, unknown>;
}

export interface InventoryChange {
  id?: string;
  listingId: string;
  retailer: string;
  changeType: 'price_change' | 'stock_change' | 'status_change' | 'new_listing' | 'removed';
  oldValue: unknown;
  newValue: unknown;
  detectedAt: Date;
  name?: string;
  game?: string;
  set_name?: string;
}

export interface PricePoint {
  id?: string;
  listingId: string;
  retailer: string;
  price: number;
  currency: string;
  recordedAt: Date;
}

export interface ReplenishmentNeed {
  id?: string;
  productName: string;
  game: ScraperGameType;
  setName?: string;
  currentStock: number;
  desiredStock: number;
  shortage: number;
  bestPrice?: number;
  bestRetailer?: string;
  bestListingId?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  alternatives: Array<{ retailer: string; price: number; quantity: number; url: string }>;
}

export interface ScrapingJob {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  retailer?: string;
  game?: ScraperGameType;
  total_urls: number;
  processed_urls: number;
  successful_scrapes: number;
  failed_scrapes: number;
  new_listings: number;
  updated_listings: number;
  started_at?: string;
  completed_at?: string;
  errors: Array<{ url: string; error: string }>;
  created_at: string;
}

export interface AuthSession {
  retailer: string;
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number }>;
  headers: Record<string, string>;
  createdAt: Date;
  expiresAt?: Date;
}
