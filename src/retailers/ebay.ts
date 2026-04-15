/**
 * Dedicated eBay scraper — parses server-rendered HTML from search results.
 * Falls back to JSON-LD extraction when CSS selectors miss.
 *
 * Unlike generic scrapers, this handles eBay's specific HTML structure,
 * anti-bot detection, and category filtering for TCG products.
 */

import * as cheerio from 'cheerio';
import { BaseRetailerScraper, ScrapeResult } from './base';
import { logger } from '../lib/logger';
import type { ScrapedListing, ScraperGameType } from '../types/scraper';

export class EbayScraper extends BaseRetailerScraper {
  constructor() {
    super({
      name: 'ebay',
      baseUrl: 'https://www.ebay.com',
      rateLimitMs: 1500,
      maxRetries: 3,
    });
  }

  async scrapeProduct(url: string): Promise<ScrapeResult> {
    try {
      const resp = await this.client.get<string>(url, {
        headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      });
      const $ = cheerio.load(resp.data);

      const name =
        $('h1.x-item-title__mainTitle span').text().trim() ||
        $('h1[itemprop="name"]').text().trim() ||
        $('h1 span.ux-textspans').first().text().trim();
      if (!name) return { listing: null, success: false, error: 'Could not extract product name' };

      const priceText =
        $('[itemprop="price"]').attr('content') ||
        $('.x-price-primary span').first().text().trim() ||
        $('span.ux-textspans--BOLD').first().text().trim();
      const price = this.parsePrice(priceText || '0');

      const imageUrl =
        $('img[itemprop="image"]').attr('src') ||
        $('img.ux-image-magnify__container--img').attr('src') ||
        $('div.ux-image-carousel-item img').first().attr('src');

      const itemId = this.extractItemId(url);

      this.requestCount++;
      return {
        listing: this.createListing({
          externalId: itemId,
          name,
          productUrl: url.split('?')[0],
          price,
          imageUrl,
          game: this.detectGame(name),
          status: price > 0 ? 'in_stock' : 'out_of_stock',
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
      const searchUrl = this.buildSearchUrl(query, game, page);

      const resp = await this.client.get<string>(searchUrl, {
        headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      });
      const html = resp.data;

      // Check for block/CAPTCHA — throw so searchAllRetailers reports the error
      if (html.includes('captcha') || html.includes('robot') || html.length < 5000) {
        logger.warn({ retailer: 'ebay', query }, 'eBay may be blocking requests (CAPTCHA or short response)');
        throw new Error('Blocked by CAPTCHA — try again later');
      }

      const $ = cheerio.load(html);

      // Strategy 1: Parse .s-item elements (eBay search IS server-side rendered)
      const htmlListings = this.parseSearchItems($, game, limit);
      if (htmlListings.length > 0) {
        listings.push(...htmlListings);
      } else {
        // Strategy 2: Try embedded JSON-LD data
        const jsonListings = this.parseJsonLd($, game, limit);
        listings.push(...jsonListings);
      }

      this.requestCount++;
      logger.info({ retailer: 'ebay', query, game, results: listings.length }, 'eBay search done');
      return listings;
    } catch (error) {
      logger.error({ error, query }, 'eBay search failed');
      return listings;
    }
  }

  private buildSearchUrl(query: string, game?: ScraperGameType, page = 1): string {
    const params = new URLSearchParams({
      _nkw: query,
      _pgn: String(page),
      LH_BIN: '1', // Buy It Now only — consistent pricing
      _sop: '15', // Sort by price + shipping: lowest first
      rt: 'nc', // No redirect
    });

    // TCG-specific eBay category
    const catId = this.getCategoryId(game);
    if (catId) params.set('_sacat', catId);

    return `https://www.ebay.com/sch/i.html?${params.toString()}`;
  }

  private parseSearchItems(
    $: ReturnType<typeof cheerio.load>,
    game: ScraperGameType | undefined,
    limit: number,
  ): ScrapedListing[] {
    const listings: ScrapedListing[] = [];

    $('li.s-item, div.s-item').each((i, el) => {
      if (listings.length >= limit) return false;
      // First .s-item is typically a "Shop on eBay" promo — skip it
      if (i === 0) return;

      const $item = $(el);

      // Name: eBay uses nested spans inside .s-item__title
      const titleEl = $item.find('.s-item__title');
      const name =
        titleEl.find('span[role="heading"]').text().trim() ||
        titleEl.find('span').first().text().trim() ||
        titleEl.text().trim();
      if (!name || name.toLowerCase().includes('shop on ebay')) return;

      // Link
      const link = $item.find('a.s-item__link').attr('href');
      if (!link) return;

      // Price
      const priceText = $item.find('.s-item__price').first().text().trim();
      const price = this.parsePrice(priceText);
      if (price === 0) return;

      // Image
      const imageUrl =
        $item.find('.s-item__image-img').attr('src') ||
        $item.find('.s-item__image-img').attr('data-src');

      // Game detection
      const detected = this.detectGame(name);
      if (game && detected !== game && detected !== 'other') return;

      // Item ID from URL
      const itemId = this.extractItemId(link);

      // Condition hint from subtitle
      const subtitle = $item.find('.s-item__subtitle').text().trim().toLowerCase();
      const condition =
        subtitle.includes('sealed') || subtitle.includes('new')
          ? 'sealed'
          : subtitle.includes('pre-owned') || subtitle.includes('used')
            ? 'lp'
            : 'sealed';

      listings.push(
        this.createListing({
          externalId: itemId,
          name,
          productUrl: link.split('?')[0],
          price,
          imageUrl: imageUrl || undefined,
          game: detected,
          status: 'in_stock',
          condition,
        }),
      );
    });

    return listings;
  }

  private parseJsonLd(
    $: ReturnType<typeof cheerio.load>,
    game: ScraperGameType | undefined,
    limit: number,
  ): ScrapedListing[] {
    const listings: ScrapedListing[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      if (listings.length >= limit) return false;
      try {
        const json = JSON.parse($(el).html() || '');
        const items = json['@type'] === 'ItemList' ? json.itemListElement : [];
        for (const entry of items) {
          if (listings.length >= limit) break;
          const product = entry.item || entry;
          if (!product.name) continue;

          const detected = this.detectGame(product.name);
          if (game && detected !== game && detected !== 'other') continue;

          const offer = product.offers || {};
          const price = parseFloat(offer.price || offer.lowPrice || '0');

          listings.push(
            this.createListing({
              externalId:
                product.productID || product.url?.match(/\/(\d+)/)?.[1] || String(Date.now()),
              name: product.name,
              productUrl: product.url || '',
              price,
              imageUrl: product.image,
              game: detected,
              status: price > 0 ? 'in_stock' : 'out_of_stock',
            }),
          );
        }
      } catch {
        // Ignore JSON parse errors
      }
    });

    return listings;
  }

  private getCategoryId(game?: ScraperGameType): string | null {
    if (!game) return '183454'; // Trading card games general
    const map: Partial<Record<ScraperGameType, string>> = {
      pokemon: '183454',
      one_piece: '183454',
      yugioh: '183454',
      mtg: '183454',
    };
    return map[game] || null;
  }

  private extractItemId(url: string): string {
    const match = url.match(/\/itm\/(\d+)/) || url.match(/item=(\d+)/);
    return match ? match[1] : Buffer.from(url).toString('base64').substring(0, 16);
  }
}

export const ebayScraper = new EbayScraper();
