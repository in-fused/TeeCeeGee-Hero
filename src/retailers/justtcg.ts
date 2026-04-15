/**
 * JustTCG API integration.
 *
 * Uses the JustTCG API for TCG pricing data:
 *   GET https://api.justtcg.com/v1/cards?search=query
 *   GET https://api.justtcg.com/v1/sets
 *   GET https://api.justtcg.com/v1/games
 *
 * Key facts:
 * - Covers Pokemon (EN + JP), One Piece, Magic, and more including sealed products
 * - Free tier: 1,000 requests/month, 100/day, 10/min (no credit card)
 * - API key in X-API-Key header
 * - Also has MCP endpoint at https://mcp.justtcg.com
 *
 * Requires JUSTTCG_API_KEY env var. Degrades gracefully without it.
 */

import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

const JTCG_API_BASE = 'https://api.justtcg.com/v1';

/** JustTCG product/card shape */
interface JTCGProduct {
  id: string;
  name: string;
  set_name?: string;
  set_code?: string;
  game?: string;
  rarity?: string;
  image_url?: string;
  prices?: {
    market?: number;
    low?: number;
    mid?: number;
    high?: number;
    tcgplayer?: number;
  };
  url?: string;
  type?: string;
  number?: string;
}

interface JTCGSearchResponse {
  data: JTCGProduct[];
  meta?: {
    total: number;
    page: number;
    per_page: number;
  };
}

export class JustTCGScraper extends BaseRetailerScraper {
  private apiKey: string | undefined;

  constructor() {
    super({
      name: 'justtcg',
      baseUrl: 'https://www.justtcg.com',
      rateLimitMs: 6500, // 10/min = 6s between requests, add margin
      maxRetries: 1,
    });
    this.apiKey = process.env.JUSTTCG_API_KEY;
  }

  private ensureApiKey(): void {
    if (!this.apiKey) {
      throw new Error(
        'JustTCG API key not configured (set JUSTTCG_API_KEY env var — free at justtcg.com)',
      );
    }
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      this.ensureApiKey();

      // Extract product ID from JustTCG URL
      const idMatch = url.match(/\/cards?\/([^/?]+)/);
      if (!idMatch) {
        return {
          listing: null,
          success: false,
          error: 'Could not extract product ID from JustTCG URL',
        };
      }

      const apiUrl = `${JTCG_API_BASE}/cards/${idMatch[1]}`;
      const resp = await this.client.get<{ data: JTCGProduct }>(apiUrl, {
        headers: {
          Accept: 'application/json',
          'X-API-Key': this.apiKey!,
        },
        referer: false,
      });

      const p = resp.data?.data;
      if (!p?.name) {
        return { listing: null, success: false, error: 'Product not found' };
      }

      this.requestCount++;
      return {
        listing: this.productToListing(p),
        success: true,
      };
    } catch (error) {
      return this.handleError(error, url);
    }
  }

  async searchProducts(
    query: string,
    game?: ScraperGameType,
    options: { page?: number; limit?: number; inStock?: boolean } = {},
  ): Promise<ScrapedListing[]> {
    const { page = 1, limit = 24 } = options;
    this.ensureApiKey();

    const params = new URLSearchParams({
      search: query,
      page: String(page),
      per_page: String(Math.min(limit, 50)),
    });

    // Map game filter to JustTCG game parameter
    if (game && game !== 'other') {
      const gameMap: Record<string, string> = {
        pokemon: 'pokemon',
        one_piece: 'one-piece',
        yugioh: 'yu-gi-oh',
        mtg: 'magic',
      };
      if (gameMap[game]) {
        params.set('game', gameMap[game]);
      }
    }

    const apiUrl = `${JTCG_API_BASE}/cards?${params.toString()}`;

    const resp = await this.client.get<JTCGSearchResponse>(apiUrl, {
      headers: {
        Accept: 'application/json',
        'X-API-Key': this.apiKey!,
      },
      referer: false,
    });

    const products = resp.data?.data;
    if (!Array.isArray(products)) {
      throw new Error('JustTCG API returned unexpected response shape');
    }

    const listings: ScrapedListing[] = [];
    for (const p of products) {
      if (!p.name) continue;

      const price = p.prices?.market || p.prices?.mid || p.prices?.tcgplayer || p.prices?.low || 0;
      if (price <= 0) continue;

      const detected = this.detectGameFromJTCG(p);
      if (game && detected !== game && detected !== 'other') continue;

      listings.push(this.productToListing(p));
    }

    this.requestCount++;
    const total = resp.data?.meta?.total || 0;
    logger.info(
      { retailer: 'justtcg', query, results: listings.length, total },
      'JustTCG search done',
    );
    return listings;
  }

  private detectGameFromJTCG(p: JTCGProduct): ScraperGameType {
    const gameStr = (p.game || '').toLowerCase();
    if (gameStr.includes('pokemon')) return 'pokemon';
    if (gameStr.includes('one piece') || gameStr.includes('one-piece')) return 'one_piece';
    if (gameStr.includes('yu-gi-oh') || gameStr.includes('yugioh')) return 'yugioh';
    if (gameStr.includes('magic') || gameStr.includes('mtg')) return 'mtg';
    // Fallback to name-based detection
    return this.detectGame(p.name);
  }

  private productToListing(p: JTCGProduct): ScrapedListing {
    const price = p.prices?.market || p.prices?.mid || p.prices?.tcgplayer || p.prices?.low || 0;

    const productUrl = p.url
      ? p.url.startsWith('http')
        ? p.url
        : `https://www.justtcg.com${p.url}`
      : `https://www.justtcg.com/cards/${p.id}`;

    return this.createListing({
      externalId: p.id,
      name: p.name,
      productUrl,
      price,
      status: price > 0 ? 'in_stock' : 'out_of_stock',
      imageUrl: p.image_url || undefined,
      game: this.detectGameFromJTCG(p),
      setName: p.set_name,
      setCode: p.set_code,
      rarity: p.rarity,
      condition: 'sealed',
      rawData: {
        marketPrice: p.prices?.market,
        lowPrice: p.prices?.low,
        midPrice: p.prices?.mid,
        highPrice: p.prices?.high,
        tcgplayerPrice: p.prices?.tcgplayer,
      },
    });
  }
}

export const justTCGScraper = new JustTCGScraper();
