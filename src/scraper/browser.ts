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
import { applyStealthScripts, isCloudflareChallenge, waitForCloudflareChallenge, humanScroll } from './stealth';

/** Captured XHR/fetch response from AJAX interception */
export interface InterceptedResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

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
  /** Apply stealth patches (navigator.webdriver, chrome.runtime, etc.) */
  stealth?: boolean;
  /** Intercept AJAX/XHR responses matching these URL patterns */
  interceptPatterns?: Array<string | RegExp>;
  /** Handle Cloudflare challenge pages automatically */
  handleCloudflare?: boolean;
  /** Use human-like scrolling instead of instant scroll */
  humanScroll?: boolean;
}

export interface RenderedPage {
  html: string;
  url: string;
  status: number;
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  /** AJAX/XHR responses captured during page load (if interceptPatterns was set) */
  interceptedResponses?: InterceptedResponse[];
}

// Playwright types (resolved at runtime via dynamic import)
type PlaywrightModule = typeof import('playwright');
type Browser = import('playwright').Browser;
type BrowserContext = import('playwright').BrowserContext;

/** Common Playwright cache directories (covers local dev, Render, Docker, etc.) */
const CACHE_DIRS = [
  join(process.env.HOME || '/root', '.cache', 'ms-playwright'),
  '/opt/render/.cache/ms-playwright',
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

      // Log what's in the cache dirs for debugging
      for (const dir of CACHE_DIRS) {
        if (existsSync(dir)) {
          try {
            const entries = readdirSync(dir);
            logger.info({ cacheDir: dir, contents: entries }, 'Playwright cache contents');
          } catch { /* can't read */ }
        }
      }

      const launchArgs = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ];

      // Strategy 1: Try default Playwright-managed binary (needs both chromium + headless-shell)
      try {
        this.browser = await this.pw.chromium.launch({ headless: true, args: launchArgs });
        this.available = true;
        logger.info('Playwright browser pool initialized (default binary)');
        return true;
      } catch (defaultErr) {
        const errMsg = defaultErr instanceof Error ? defaultErr.message : String(defaultErr);
        logger.info({ error: errMsg }, 'Default Chromium launch failed — trying alternatives');
      }

      // Strategy 2: Try with explicit executablePath from cache scan
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
          logger.info(
            { error: cachedErr instanceof Error ? cachedErr.message : String(cachedErr), executablePath: execPath },
            'Cached Chromium binary failed to launch',
          );
        }
      }

      // Strategy 3: Try launching with channel='chromium' (uses system-installed Chromium)
      try {
        this.browser = await this.pw.chromium.launch({
          headless: true,
          channel: 'chromium',
          args: launchArgs,
        });
        this.available = true;
        logger.info('Playwright browser pool initialized (system chromium channel)');
        return true;
      } catch {
        // System chromium not available
      }

      // Strategy 4: Try runtime install, then retry all approaches
      const installed = this.tryRuntimeInstall();
      if (installed) {
        // Retry default launch
        try {
          this.browser = await this.pw.chromium.launch({ headless: true, args: launchArgs });
          this.available = true;
          logger.info('Playwright browser pool initialized (runtime install)');
          return true;
        } catch (installErr) {
          logger.info(
            { error: installErr instanceof Error ? installErr.message : String(installErr) },
            'Post-install default launch failed — scanning cache',
          );
        }

        // Retry cache scan
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
      logger.warn('Playwright unavailable — no compatible Chromium binary found. Check build command includes: npx playwright install --with-deps chromium chromium-headless-shell');
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
   * Checks both full chromium and headless shell variants.
   * Returns the executable path, or null if none found.
   */
  private findCachedChromium(): string | null {
    for (const cacheDir of CACHE_DIRS) {
      if (!existsSync(cacheDir)) continue;

      try {
        const allEntries = readdirSync(cacheDir);
        logger.info({ cacheDir, entries: allEntries }, 'Scanning Playwright cache directory');

        // 1. Check for headless shell first (Playwright prefers this for headless mode)
        const headlessShellEntries = allEntries
          .filter((d) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-headless-shell-'))
          .sort()
          .reverse();

        for (const entry of headlessShellEntries) {
          // Playwright 1.58+ path: chromium_headless_shell-XXXX/chrome-headless-shell-linux64/chrome-headless-shell
          const hsLinuxPath = join(cacheDir, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
          if (existsSync(hsLinuxPath)) {
            logger.info({ path: hsLinuxPath, version: entry }, 'Found cached headless shell');
            return hsLinuxPath;
          }
          // Alternative layout
          const hsAltPath = join(cacheDir, entry, 'chrome-headless-shell');
          if (existsSync(hsAltPath)) {
            logger.info({ path: hsAltPath, version: entry }, 'Found cached headless shell (alt path)');
            return hsAltPath;
          }
        }

        // 2. Fall back to full chromium binary
        const chromiumEntries = allEntries
          .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
          .sort()
          .reverse();

        for (const entry of chromiumEntries) {
          // Linux path
          const linuxPath = join(cacheDir, entry, 'chrome-linux', 'chrome');
          if (existsSync(linuxPath)) {
            logger.info({ path: linuxPath, version: entry }, 'Found cached Chromium');
            return linuxPath;
          }
          // macOS path
          const macPath = join(cacheDir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
          if (existsSync(macPath)) {
            logger.info({ path: macPath, version: entry }, 'Found cached Chromium');
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
      execSync('npx playwright install chromium chromium-headless-shell', {
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
      stealth: useStealth = false,
      interceptPatterns,
      handleCloudflare = false,
      humanScroll: useHumanScroll = false,
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

      // Apply stealth patches before any navigation
      if (useStealth) {
        await applyStealthScripts(page);
      }

      // Set up AJAX/XHR interception
      const intercepted: InterceptedResponse[] = [];
      if (interceptPatterns && interceptPatterns.length > 0) {
        page.on('response', async (response) => {
          const resUrl = response.url();
          const matches = interceptPatterns.some((p) =>
            typeof p === 'string' ? resUrl.includes(p) : p.test(resUrl),
          );
          if (!matches) return;

          try {
            const contentType = response.headers()['content-type'] || '';
            // Only capture JSON/text responses, skip binaries
            if (contentType.includes('json') || contentType.includes('text') || contentType.includes('javascript')) {
              const body = await response.text();
              intercepted.push({
                url: resUrl,
                status: response.status(),
                contentType,
                body,
              });
            }
          } catch {
            // Response body unavailable (redirect, etc.) — skip
          }
        });
      }

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

      // Handle Cloudflare challenge pages
      if (handleCloudflare && (await isCloudflareChallenge(page))) {
        logger.info({ url }, 'Cloudflare challenge detected — waiting for resolution');
        const resolved = await waitForCloudflareChallenge(page, { timeout: timeout / 2 });
        if (!resolved) {
          logger.warn({ url }, 'Cloudflare challenge not resolved');
        }
      }

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

      // Scroll to trigger lazy-loaded content
      if (useHumanScroll) {
        await humanScroll(page, { steps: 3, delayMin: 300, delayMax: 800 });
      } else {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)');
        await new Promise((r) => setTimeout(r, getRandomDelay(500, 1500)));
      }

      const html = await page.content();
      const pageCookies = (await context.cookies()).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      }));

      return {
        html,
        url: page.url(),
        status,
        cookies: pageCookies,
        interceptedResponses: intercepted.length > 0 ? intercepted : undefined,
      };
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
