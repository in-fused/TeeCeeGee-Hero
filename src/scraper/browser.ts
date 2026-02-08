/**
 * Browser pool manager for Playwright-backed scraping.
 *
 * Manages a singleton Chromium browser with per-retailer contexts.
 * Playwright is dynamically imported — if not installed or browsers
 * not downloaded, all methods degrade gracefully.
 *
 * Usage:
 *   const pool = BrowserPool.getInstance();
 *   const html = await pool.getRenderedHtml(url, { waitSelector: '.products' });
 *   // ... parse html with cheerio
 *   await pool.shutdown();
 */

import { logger } from '../lib/logger';
import { generateFingerprint, fingerprintToHeaders, getRandomDelay } from './fingerprint';

/** Options for rendering a page */
export interface RenderOptions {
  /** CSS selector to wait for before capturing HTML */
  waitSelector?: string;
  /** Max ms to wait for navigation / selectors (default 30_000) */
  timeout?: number;
  /** Playwright waitUntil event (default 'domcontentloaded') */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Extra headers to send */
  headers?: Record<string, string>;
  /** Cookie string to inject */
  cookies?: string;
  /** Block images / stylesheets to speed up rendering */
  blockAssets?: boolean;
  /** Evaluate JS after page load (e.g. scroll to trigger lazy loads) */
  postLoadScript?: string;
}

export interface RenderedPage {
  html: string;
  url: string;
  status: number;
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
}

// Playwright types (resolved at runtime via dynamic import)
type PlaywrightModule = typeof import('playwright');
type Browser = import('playwright').Browser;
type BrowserContext = import('playwright').BrowserContext;

export class BrowserPool {
  private static instance: BrowserPool | null = null;

  private pw: PlaywrightModule | null = null;
  private browser: Browser | null = null;
  private available = false;
  private initializing: Promise<boolean> | null = null;
  private contextCount = 0;
  private readonly maxContexts = 5;

  private constructor() {}

  static getInstance(): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool();
    }
    return BrowserPool.instance;
  }

  /** Lazy-initialize Playwright + Chromium. Returns false if unavailable. */
  async init(): Promise<boolean> {
    if (this.available && this.browser?.isConnected()) return true;
    if (this.initializing) return this.initializing;

    this.initializing = this.doInit();
    const result = await this.initializing;
    this.initializing = null;
    return result;
  }

  private async doInit(): Promise<boolean> {
    try {
      // Dynamic import — keeps Playwright fully optional
      this.pw = await (Function('return import("playwright")')() as Promise<PlaywrightModule>);
      this.browser = await this.pw.chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });

      this.available = true;
      logger.info('Playwright browser pool initialized');
      return true;
    } catch (err) {
      this.available = false;
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Playwright unavailable — browser scrapers will be skipped',
      );
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available && !!this.browser?.isConnected();
  }

  /**
   * Navigate to a URL in a fresh browser context, wait for JS to render,
   * and return the fully-rendered HTML.
   */
  async getRenderedHtml(url: string, options: RenderOptions = {}): Promise<RenderedPage | null> {
    if (!(await this.init())) return null;
    if (!this.browser || !this.pw) return null;

    const {
      waitSelector,
      timeout = 30_000,
      waitUntil = 'domcontentloaded',
      headers,
      cookies,
      blockAssets = true,
      postLoadScript,
    } = options;

    // Respect concurrency limit
    if (this.contextCount >= this.maxContexts) {
      logger.warn({ url, active: this.contextCount }, 'Browser pool full — waiting');
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (this.contextCount < this.maxContexts) {
            clearInterval(check);
            resolve();
          }
        }, 500);
      });
    }

    let context: BrowserContext | null = null;
    try {
      this.contextCount++;

      // Use a fresh fingerprint for each context
      const fp = generateFingerprint('html');
      const fpHeaders = fingerprintToHeaders(fp);

      context = await this.browser.newContext({
        userAgent: fp.userAgent,
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        extraHTTPHeaders: { ...fpHeaders, ...headers },
        javaScriptEnabled: true,
      });

      // Inject cookies if provided
      if (cookies) {
        const parsed = cookies.split(';').map((c) => {
          const [name, ...rest] = c.trim().split('=');
          return {
            name: name.trim(),
            value: rest.join('=').trim(),
            domain: new URL(url).hostname,
            path: '/',
          };
        });
        await context.addCookies(parsed);
      }

      const page = await context.newPage();

      // Block heavy resources to speed up rendering
      if (blockAssets) {
        await page.route('**/*', (route) => {
          const type = route.request().resourceType();
          if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
            return route.abort();
          }
          return route.continue();
        });
      }

      // Add human-like jitter before navigation
      await new Promise((r) => setTimeout(r, getRandomDelay(200, 800)));

      const response = await page.goto(url, {
        waitUntil,
        timeout,
      });

      const status = response?.status() ?? 0;

      // Wait for the target selector if provided
      if (waitSelector) {
        try {
          await page.waitForSelector(waitSelector, { timeout: timeout / 2 });
        } catch {
          logger.debug({ url, waitSelector }, 'Wait selector not found — returning current HTML');
        }
      }

      // Execute post-load script (e.g. scroll to trigger lazy loading)
      if (postLoadScript) {
        await page.evaluate(postLoadScript);
        // Small wait after script execution
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Scroll down to trigger lazy-loaded content
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)');
      await new Promise((r) => setTimeout(r, getRandomDelay(500, 1500)));

      const html = await page.content();
      const pageCookies = (await context.cookies()).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      }));

      return { html, url: page.url(), status, cookies: pageCookies };
    } catch (err) {
      logger.error({ url, error: err instanceof Error ? err.message : String(err) }, 'Browser render failed');
      return null;
    } finally {
      this.contextCount--;
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }

  /** Close the browser and release resources. */
  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.available = false;
    this.contextCount = 0;
    BrowserPool.instance = null;
    logger.info('Playwright browser pool shut down');
  }
}
