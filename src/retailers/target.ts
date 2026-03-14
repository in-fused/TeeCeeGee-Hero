/**
 * Target Redsky API integration.
 *
 * Uses Target's internal Redsky aggregation API:
 *   GET https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1
 *
 * Key facts:
 * - Reverse-engineered internal API (public-facing, no auth beyond static key)
 * - Static API key embedded in Target's frontend JS
 * - Returns product search results with pricing and availability
 * - IP-based rate limiting — use conservative pacing
 * - No browser automation needed — pure REST
 *
 * Risk: Target may change/restrict this API at any time.
 * Degrades gracefully — throws clear error if API returns unexpected response.
 */

import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

const REDSKY_BASE = 'https://redsky.target.com/redsky_aggregations/v1';
const REDSKY_KEY = 'ff457966e64d5e877fdbad070f276d18ecec4a01';

/** Redsky search result product shape */
interface RedSkyProduct {
  tcin: string;
  item: {
    product_description?: {
      title: string;
      downstream_description?: string;
    };
    enrichment?: {
      images?: {
        primary_image_url?: string;
      };
      buy_url?: string;
    };
    product_classification?: {
      product_type_name?: string;
      merchandise_type_name?: string;
    };
  };
  price?: {
    formatted_current_price?: string;
    current_retail?: number;
    reg_retail?: number;
    is_current_price_range?: boolean;
  };
  fulfillment?: {
    is_out_of_stock_in_all_store_locations?: boolean;
    shipping_options?: {
      availability_status?: string;
    };
  };
}

interface RedSkySearchResponse {
  data: {
    search: {
      products: RedSkyProduct[];
      search_response: {
        typed_metadata: {
          total_results: number;
          offset: number;
          count: number;
        };
      };
    };
  };
}

export class TargetScraper extends BaseRetailerScraper {
  constructor() {
    super({
      name: 'target',
      baseUrl: 'https://www.target.com',
      rateLimitMs: 3000, // Conservative — Target is aggressive with IP bans
      maxRetries: 2,
    });
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      // Extract TCIN from Target URL: /p/product-name/-/A-12345678
      const tcinMatch = url.match(/A-(\d+)/) || url.match(/(\d{8})/);
      if (!tcinMatch) {
        return { listing: null, success: false, error: 'Could not extract TCIN from Target URL' };
      }

      const tcin = tcinMatch[1];
      const apiUrl = `${REDSKY_BASE}/web/pdp_client_v1?key=${REDSKY_KEY}&tcins=${tcin}&has_pricing_store_id=true&pricing_store_id=1859&channel=WEB&visitor_id=1&is_bot=false`;

      const resp = await this.client.get<{ data: { product: RedSkyProduct } }>(apiUrl, {
        headers: {
          Accept: 'application/json',
          Origin: 'https://www.target.com',
          Referer: 'https://www.target.com/',
        },
        referer: false,
      });

      const product = resp.data?.data?.product;
      if (!product?.item?.product_description?.title) {
        return { listing: null, success: false, error: 'Product not found in Target API' };
      }

      this.requestCount++;
      return {
        listing: this.productToListing(product),
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
    const offset = (page - 1) * limit;

    const params = new URLSearchParams({
      key: REDSKY_KEY,
      keyword: query,
      channel: 'WEB',
      page: `/s/${encodeURIComponent(query)}`,
      visitor_id: '1',
      is_bot: 'false',
      pricing_store_id: '1859',
      pricing_context: 'digital',
      sort_by: 'relevance',
      offset: String(offset),
      count: String(limit),
    });

    const apiUrl = `${REDSKY_BASE}/web/plp_search_v1?${params.toString()}`;

    const resp = await this.client.get<RedSkySearchResponse>(apiUrl, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://www.target.com',
        Referer: 'https://www.target.com/',
      },
      referer: false,
    });

    const products = resp.data?.data?.search?.products;
    if (!Array.isArray(products)) {
      throw new Error('Target Redsky API returned unexpected response shape');
    }

    const listings: ScrapedListing[] = [];
    for (const p of products) {
      const title = p.item?.product_description?.title;
      if (!title) continue;

      const price = p.price?.current_retail || 0;
      if (price <= 0) continue;

      const detected = this.detectGame(title);
      if (game && detected !== game && detected !== 'other') continue;

      listings.push(this.productToListing(p));
    }

    this.requestCount++;
    const total = resp.data?.data?.search?.search_response?.typed_metadata?.total_results || 0;
    logger.info(
      { retailer: 'target', query, results: listings.length, total },
      'Target search done',
    );
    return listings;
  }

  private productToListing(p: RedSkyProduct): ScrapedListing {
    const title = p.item?.product_description?.title || '';
    const price = p.price?.current_retail || 0;
    const regPrice = p.price?.reg_retail;
    const imageUrl = p.item?.enrichment?.images?.primary_image_url;
    const buyUrl = p.item?.enrichment?.buy_url;

    const productUrl = buyUrl
      ? buyUrl.startsWith('http')
        ? buyUrl
        : `https://www.target.com${buyUrl}`
      : `https://www.target.com/p/-/A-${p.tcin}`;

    const isOutOfStock = p.fulfillment?.is_out_of_stock_in_all_store_locations;
    const shippingStatus = p.fulfillment?.shipping_options?.availability_status;
    const inStock = !isOutOfStock || shippingStatus === 'IN_STOCK';

    return this.createListing({
      externalId: p.tcin,
      name: title,
      productUrl,
      price,
      msrp: regPrice && regPrice !== price ? regPrice : undefined,
      status: inStock ? 'in_stock' : 'out_of_stock',
      imageUrl: imageUrl || undefined,
      game: this.detectGame(title),
      condition: 'sealed',
    });
  }
}

export const targetScraper = new TargetScraper();
