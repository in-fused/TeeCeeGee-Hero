/**
 * API client for the scraper dashboard.
 * All scraper endpoints are under /admin/scraper and require ADMIN_SECRET.
 * The dashboard uses a password gate (client-side only — "PackFinder").
 * The actual API auth uses ADMIN_SECRET from env vars set in Render.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function scraperRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      // ADMIN_SECRET must be set as VITE_ADMIN_SECRET in the web env
      // or requests will be unauthenticated (fine for read-only public stats)
      ...(import.meta.env.VITE_ADMIN_SECRET
        ? { Authorization: `Bearer ${import.meta.env.VITE_ADMIN_SECRET}` }
        : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data !== undefined ? json.data : json;
}

export interface ScraperListing {
  id?: string;
  externalId?: string;
  external_id?: string;
  retailer: string;
  productUrl?: string;
  product_url?: string;
  name: string;
  game: string;
  productType?: string;
  product_type?: string;
  setName?: string;
  set_name?: string;
  price: number;
  status: string;
  imageUrl?: string;
  image_url?: string;
  currency?: string;
  scraped_at?: string;
}

export interface ScraperStatusResponse {
  scrapers: Array<{ name: string; requestCount: number }>;
  database: {
    totalListings: number;
    activeListings: number;
    byRetailer: Array<{ retailer: string; count: number }>;
    byGame: Array<{ game: string; count: number }>;
    recentChanges: number;
  };
}

export interface ScrapingJobResponse {
  id: string;
  name: string;
  status: string;
  retailer?: string;
  game?: string;
  total_urls: number;
  processed_urls: number;
  successful_scrapes: number;
  failed_scrapes: number;
  new_listings: number;
  updated_listings: number;
  created_at: string;
}

export interface InventoryChangeResponse {
  id: string;
  listing_id: string;
  retailer: string;
  change_type: string;
  old_value: unknown;
  new_value: unknown;
  detected_at: string;
  name?: string;
  game?: string;
  product_url?: string;
  current_price?: number;
  current_status?: string;
}

export function scraperStatus(): Promise<ScraperStatusResponse> {
  return scraperRequest('/admin/scraper/status');
}

export interface ScraperSearchResult {
  results: ScraperListing[];
  errors?: Array<{ retailer: string; error: string }>;
}

export async function scraperSearch(query: string): Promise<ScraperSearchResult> {
  const params = new URLSearchParams({ q: query, limit: '20' });
  const url = `${API_BASE}/admin/scraper/search?${params}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(import.meta.env.VITE_ADMIN_SECRET
        ? { Authorization: `Bearer ${import.meta.env.VITE_ADMIN_SECRET}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const json = await res.json();
  return { results: json.data || [], errors: json.meta?.errors };
}

export async function scraperListings(filters: Record<string, string> = {}): Promise<{
  listings: ScraperListing[];
  total: number;
}> {
  const params = new URLSearchParams(filters);
  const resp = await fetch(`${API_BASE}/admin/scraper/listings?${params}`, {
    headers: {
      ...(import.meta.env.VITE_ADMIN_SECRET
        ? { Authorization: `Bearer ${import.meta.env.VITE_ADMIN_SECRET}` }
        : {}),
    },
  });
  if (!resp.ok) return { listings: [], total: 0 };
  const json = await resp.json();
  return { listings: json.data || [], total: json.meta?.total || 0 };
}

export function scraperJobs(): Promise<ScrapingJobResponse[]> {
  return scraperRequest('/admin/scraper/jobs');
}

export function scraperChanges(): Promise<InventoryChangeResponse[]> {
  return scraperRequest('/admin/scraper/changes?limit=20');
}
