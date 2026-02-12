/**
 * CoolStuffInc scraper — Cloudflare-protected retailer.
 *
 * CoolStuffInc uses Cloudflare Bot Management with JavaScript challenges.
 * Strategy:
 *   1. Playwright + stealth scripts (bypass navigator.webdriver detection)
 *   2. Cloudflare challenge auto-wait (JS challenge typically resolves in 3-5s)
 *   3. AJAX interception — CSI loads product data via internal API calls
 *   4. Cheerio fallback for server-rendered HTML
 *
 * Note: This scraper REQUIRES Playwright. Without it, searches return empty.
 */

import * as cheerio from 'cheerio';
import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import { BrowserPool, InterceptedResponse } from '../scraper/browser';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

export class CoolStuffIncScraper extends BaseRetailerScraper {
  constructor() {
    super({
      name: 'coolstuffinc',
      baseUrl: 'https://www.coolstuffinc.com',
      rateLimitMs: 3000,
      maxRetries: 2,
    });
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      const html = await this.renderWithStealth(url);
      if (!html) {
        return { listing: null, success: false, error: 'CoolStuffInc requires browser automation (Playwright unavailable)' };
      }

      const $ = cheerio.load(html);

      const name =
        $('h1.product-name, h1.product-title').text().trim() ||
        $('h1').first().text().trim();
      if (!name) return { listing: null, success: false, error: 'Could not extract product name' };

      const priceText =
        $('.product-price .price, .price-tag').first().text().trim() ||
        $('[data-price]').first().attr('data-price') || '';
      const price = this.parsePrice(priceText);

      const imageUrl =
        $('img.product-image, .product-gallery img').first().attr('src') ||
        $('img[data-zoom-image]').first().attr('src');

      const availText =
        $('.product-availability, .availability-status').first().text().trim() ||
        $('.add-to-cart-btn').length > 0 ? 'in stock' : 'out of stock';
      const status = this.parseStatus(availText);

      this.requestCount++;
      return {
        listing: this.createListing({
          externalId: this.extractId(url),
          name,
          productUrl: url.split('?')[0],
          price,
          imageUrl: imageUrl || undefined,
          game: this.detectGame(name),
          status,
        }),
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
    const listings: ScrapedListing[] = [];

    try {
      // CoolStuffInc search URL pattern
      const searchUrl = `https://www.coolstuffinc.com/sq?q=${encodeURIComponent(query)}&page=${page}`;

      const pool = BrowserPool.getInstance();
      const result = await pool.getRenderedHtml(searchUrl, {
        waitSelector: '.product-grid, .product-list, .search-results',
        timeout: 45_000,
        waitUntil: 'domcontentloaded',
        blockAssets: false, // CSI may need stylesheets for layout
        stealth: true,
        handleCloudflare: true,
        humanScroll: true,
        // Intercept CSI's internal API calls for product data
        interceptPatterns: ['/api/', '/products/', '/search/', 'graphql'],
      });

      if (!result) {
        throw new Error('CoolStuffInc requires browser automation (Playwright not available)');
      }

      // Strategy 1: Try parsing intercepted AJAX responses
      if (result.interceptedResponses && result.interceptedResponses.length > 0) {
        const ajaxListings = this.parseInterceptedResponses(result.interceptedResponses, game, limit);
        if (ajaxListings.length > 0) {
          listings.push(...ajaxListings);
          this.requestCount++;
          logger.info(
            { retailer: 'coolstuffinc', query, results: listings.length, source: 'ajax' },
            'CoolStuffInc search done (via AJAX)',
          );
          return listings;
        }
      }

      // Strategy 2: Parse the rendered HTML
      const $ = cheerio.load(result.html);
      const htmlListings = this.parseSearchResults($, game, limit);
      listings.push(...htmlListings);

      this.requestCount++;
      logger.info(
        { retailer: 'coolstuffinc', query, results: listings.length, source: 'html' },
        'CoolStuffInc search done',
      );
      return listings;
    } catch (error) {
      // Re-throw so searchAllRetailers can report this error to the frontend
      throw error;
    }
  }

  private parseInterceptedResponses(
    responses: InterceptedResponse[],
    game: ScraperGameType | undefined,
    limit: number,
  ): ScrapedListing[] {
    const listings: ScrapedListing[] = [];

    for (const resp of responses) {
      if (!resp.contentType.includes('json')) continue;

      try {
        const data = JSON.parse(resp.body);
        // Look for product arrays in various response shapes
        const products = data.products || data.results || data.items || data.data?.products || [];

        if (!Array.isArray(products)) continue;

        for (const p of products) {
          if (listings.length >= limit) break;

          const name = p.name || p.title || p.productName;
          if (!name) continue;

          const detected = this.detectGame(name);
          if (game && detected !== game && detected !== 'other') continue;

          const price = parseFloat(p.price || p.salePrice || p.msrp || '0');
          if (price <= 0) continue;

          listings.push(
            this.createListing({
              externalId: String(p.id || p.productId || p.sku || Date.now()),
              name,
              productUrl: p.url
                ? (p.url.startsWith('http') ? p.url : `https://www.coolstuffinc.com${p.url}`)
                : `https://www.coolstuffinc.com/p/${p.id || ''}`,
              price,
              imageUrl: p.image || p.imageUrl || p.thumbnail,
              game: detected,
              status: p.inStock !== false && price > 0 ? 'in_stock' : 'out_of_stock',
              quantity: p.quantity || p.qty,
            }),
          );
        }
      } catch {
        // Not valid JSON or unexpected shape — skip
      }
    }

    return listings;
  }

  private parseSearchResults(
    $: ReturnType<typeof cheerio.load>,
    game: ScraperGameType | undefined,
    limit: number,
  ): ScrapedListing[] {
    const listings: ScrapedListing[] = [];

    // CoolStuffInc product card selectors (multiple fallback patterns)
    const productSelectors = [
      '.product-card',
      '.product-tile',
      '.product-item',
      '.search-result-item',
      '[data-product-id]',
      '.product-grid-item',
    ];

    const productSel = productSelectors.find((sel) => $(sel).length > 0) || '.product-card';

    $(productSel).each((_, el) => {
      if (listings.length >= limit) return false;

      const $p = $(el);

      // Name extraction with fallbacks
      const name =
        $p.find('.product-name, .product-title, h3, h4').first().text().trim() ||
        $p.find('a[title]').first().attr('title')?.trim() || '';
      if (!name) return;

      // Link
      const link =
        $p.find('a.product-link, a[href*="/p/"]').first().attr('href') ||
        $p.find('a').first().attr('href');
      if (!link) return;
      const productUrl = link.startsWith('http') ? link : `https://www.coolstuffinc.com${link}`;

      // Price
      const priceText =
        $p.find('.price, .product-price, .sale-price').first().text().trim() ||
        $p.find('[data-price]').first().attr('data-price') || '';
      const price = this.parsePrice(priceText);
      if (price <= 0) return;

      // Image
      const imageUrl =
        $p.find('img').first().attr('src') ||
        $p.find('img').first().attr('data-src');

      // Game detection and filtering
      const detected = this.detectGame(name);
      if (game && detected !== game && detected !== 'other') return;

      // Availability
      const availText = $p.find('.availability, .stock-status').text().trim().toLowerCase();
      const hasAddToCart = $p.find('.add-to-cart, [data-action="add-to-cart"]').length > 0;
      const status = availText.includes('out of stock')
        ? 'out_of_stock' as const
        : (hasAddToCart || price > 0) ? 'in_stock' as const : 'out_of_stock' as const;

      listings.push(
        this.createListing({
          externalId: $p.attr('data-product-id') || this.extractId(productUrl),
          name,
          productUrl,
          price,
          imageUrl: imageUrl || undefined,
          game: detected,
          status,
        }),
      );
    });

    return listings;
  }

  private async renderWithStealth(url: string): Promise<string | null> {
    const pool = BrowserPool.getInstance();
    const result = await pool.getRenderedHtml(url, {
      timeout: 45_000,
      waitUntil: 'domcontentloaded',
      blockAssets: false,
      stealth: true,
      handleCloudflare: true,
      humanScroll: true,
    });
    return result?.html || null;
  }

  private extractId(url: string): string {
    // CoolStuffInc URLs: /p/123456 or /product/slug
    const match = url.match(/\/p\/(\d+)/) || url.match(/\/product\/([^/?]+)/);
    return match ? match[1] : Buffer.from(url).toString('base64').substring(0, 16);
  }
}

export const coolStuffIncScraper = new CoolStuffIncScraper();
