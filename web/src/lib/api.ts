const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || body.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface Product {
  id: number;
  tcgplayer_id: string;
  name: string;
  normalized_name: string;
  category: string;
  set_name: string | null;
  game: 'pokemon' | 'one_piece';
  product_type: string;
  language: string;
  source: string;
}

export interface ProductSearchResult {
  total: number;
  limit: number;
  offset: number;
  products: Product[];
  status?: string;
}

export interface Store {
  id: number;
  name: string;
  store_type: string;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  distance_miles: number;
  source: string;
}

export interface StoreSearchProduct {
  id: number;
  name: string;
  game: string;
  product_type: string;
  image_url: string | null;
  market_price: number | null;
  tcgplayer_id: string | null;
  links: {
    tcgplayer: string | null;
    ebay_search: string;
  };
}

export interface ScrapedListingResult {
  id: string;
  name: string;
  game: string;
  product_type: string;
  image_url: string | null;
  price: number;
  currency: string;
  status: string;
  retailer: string;
  product_url: string;
  set_name: string | null;
  condition: string;
  quantity: number | null;
  scraped_at: string;
}

export interface StoreSearchResult {
  zip: string;
  radius: number;
  center: { latitude: number; longitude: number };
  total: number;
  stores: Store[];
  products?: StoreSearchProduct[];
  listings?: ScrapedListingResult[];
  status?: string;
}

export interface Signal {
  id: number;
  product_id: number;
  store_id: number;
  store_name: string;
  signal_type: string;
  confidence: number;
  observed_at: string;
}

export function searchProducts(params: {
  game?: string;
  type?: string;
  q?: string;
  limit?: string;
  offset?: string;
}) {
  return request<ProductSearchResult>('/products/search', params);
}

export function searchStores(params: { zip: string; radius?: string; store_type?: string }) {
  return request<StoreSearchResult>('/search', params);
}

export function getProductSignals(productId: number) {
  return request<{ product_id: number; signals: Signal[] }>(`/products/${productId}/signals`);
}

export interface ProductDetail extends Product {
  links: {
    tcgplayer: string;
    ebay_search: string;
  };
}

export interface StoreWithSignal extends Store {
  signal_type: string;
  confidence: number;
  observed_at: string;
}

export interface ProductWithSignal extends Product {
  signal_type: string;
  confidence: number;
  observed_at: string;
  links: {
    tcgplayer: string;
    ebay_search: string;
  };
}

export function getProduct(productId: number) {
  return request<ProductDetail>(`/products/${productId}`);
}

export function getProductStores(productId: number) {
  return request<{ product_id: number; total: number; stores: StoreWithSignal[] }>(
    `/products/${productId}/stores`,
  );
}

export function getStoreProducts(storeId: number) {
  return request<{ store_id: number; total: number; products: ProductWithSignal[] }>(
    `/stores/${storeId}/products`,
  );
}

// ── Public price endpoints (no admin auth) ──

export interface PriceSearchResult {
  results: ScrapedListingResult[];
  source: 'cache' | 'live';
  total: number;
  errors?: Array<{ retailer: string; error: string }>;
}

export interface PriceChangeResult {
  id: string;
  change_type: string;
  old_value: unknown;
  new_value: unknown;
  detected_at: string;
  retailer: string;
  name: string;
  game: string;
  product_url: string;
  current_price: number;
  current_status: string;
}

export function searchPrices(params: { q: string; game?: string; limit?: string }) {
  return request<PriceSearchResult>('/prices/search', params);
}

export function getRecentPrices() {
  return request<{ results: ScrapedListingResult[]; total: number }>('/prices/recent');
}

export function getPriceChanges(params?: { limit?: string }) {
  return request<{ results: PriceChangeResult[]; total: number }>('/prices/changes', params);
}
