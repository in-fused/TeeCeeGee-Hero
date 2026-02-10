/**
 * Browser pool manager for Playwright-backed scraping.
 *
 * Manages a singleton Chromium browser with per-retailer contexts.
 * Playwright is dynamically imported — if not installed or browsers
 * not downloaded, all methods degrade gracefully.
 *
 * Browser discovery order:
 *   1. Default Playwright-managed Chromium (exact version match)
 *   2. Any compatible Chromium in the Playwright cache
 *   3. Runtime install attempt (npx playwright install chromium)
 *   4. Graceful degradation — HTTP-only scrapers still work
 *
 * Usage:
 *   const pool = BrowserPool.getInstance();
 *   const html = await pool.getRenderedHtml(url, { waitSelector: '.products' });
 *   // ... parse html with cheerio
 *   await pool.shutdown();
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
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

/** Common Playwright cache directories */
const CACHE_DIRS = [
  join(process.env.HOME || '/root', '.cache', 'ms-playwright'),
  '/tmp/ms-playwright',
];

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

      const launchArgs = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ];

      // Strategy 1: Try default Playwright-managed binary
      try {
        this.browser = await this.pw.chromium.launch({ headless: true, args: launchArgs });
        this.available = true;
        logger.info('Playwright browser pool initialized (default binary)');
        return true;
      } catch (defaultErr) {
        logger.debug(
          { error: defaultErr instanceof Error ? defaultErr.message : String(defaultErr) },
          'Default Chromium binary not found — scanning for alternatives',
        );
      }

      // Strategy 2: Scan for any available Chromium in the cache
      const execPath = this.findCachedChromium();
      if (execPath) {
        try {
          this.browser = await this.pw.chromium.launch({
            headless: true,
            executablePath: execPath,
            args: launchArgs,
          });
          this.available = true;
          logger.info({ executablePath: execPath }, 'Playwright browser pool initialized (cached binary)');
          return true;
        } catch (cachedErr) {
          logger.debug(
            { error: cachedErr instanceof Error ? cachedErr.message : String(cachedErr) },
            'Cached Chromium binary failed to launch',
          );
        }
      }

      // Strategy 3: Try runtime install
      const installed = this.tryRuntimeInstall();
      if (installed) {
        try {
          this.browser = await this.pw.chromium.launch({ headless: true, args: launchArgs });
          this.available = true;
          logger.info('Playwright browser pool initialized (runtime install)');
          return true;
        } catch (installErr) {
          logger.warn(
            { error: installErr instanceof Error ? installErr.message : String(installErr) },
            'Runtime-installed Chromium failed to launch',
          );
        }

        // Try scanning cache again after install (might be a different path)
        const newPath = this.findCachedChromium();
        if (newPath) {
          try {
            this.browser = await this.pw.chromium.launch({
              headless: true,
              executablePath: newPath,
              args: launchArgs,
            });
            this.available = true;
            logger.info({ executablePath: newPath }, 'Playwright browser pool initialized (post-install scan)');
            return true;
          } catch {
            // All strategies exhausted
          }
        }
      }

      this.available = false;
      logger.warn('Playwright unavailable — no compatible Chromium binary found');
      return false;
    } catch (err) {
      this.available = false;
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Playwright unavailable — browser scrapers will be skipped',
      );
      return false;
    }
  }

  /**
   * Scan Playwright cache directories for any chromium binary.
   * Returns the executable path, or null if none found.
   */
  private findCachedChromium(): string | null {
    for (const cacheDir of CACHE_DIRS) {
      if (!existsSync(cacheDir)) continue;

      try {
        const entries = readdirSync(cacheDir)
          .filter((d) => d.startsWith('chromium-') && !d.includes('headless_shell'))
          .sort()
          .reverse(); // Newest version first

        for (const entry of entries) {
          // Linux path
          const linuxPath = join(cacheDir, entry, 'chrome-linux', 'chrome');
          if (existsSync(linuxPath)) {
            logger.debug({ path: linuxPath, version: entry }, 'Found cached Chromium');
            return linuxPath;
          }
          // macOS path
          const macPath = join(cacheDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
          if (existsSync(macPath)) {
            logger.debug({ path: macPath, version: entry }, 'Found cached Chromium');
            return macPath;
          }
        }
      } catch {
        // Can't read directory — skip
      }
    }
    return null;
  }

  /**
   * Attempt to install Chromium at runtime via `npx playwright install chromium`.
   * Returns true if the install command succeeds.
   */
  private tryRuntimeInstall(): boolean {
    try {
      logger.info('Attempting runtime Chromium install...');
      execSync('npx playwright install chromium', {
        timeout: 120_000,
        stdio: 'pipe',
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' }, // Use default cache location
      });
      logger.info('Runtime Chromium install succeeded');
      return true;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : 'install failed' },
        'Runtime Chromium install failed — browser scrapers unavailable',
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
