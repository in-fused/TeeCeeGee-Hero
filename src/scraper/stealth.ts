/**
 * Stealth module for Playwright browser automation.
 *
 * Applies anti-detection patches to browser contexts and pages:
 * - navigator.webdriver spoofing
 * - chrome.runtime injection
 * - WebGL vendor/renderer masking
 * - Canvas fingerprint randomization
 * - Permission API spoofing
 * - Plugin/MimeType arrays
 * - Cloudflare challenge detection + wait
 *
 * Usage:
 *   const page = await context.newPage();
 *   await applyStealthScripts(page);
 */

import { logger } from '../lib/logger';

// Playwright types (resolved at runtime)
type Page = import('playwright').Page;

/**
 * Core stealth script injected via addInitScript.
 * Runs before any page JS — patches navigator, chrome, WebGL, etc.
 */
const STEALTH_INIT_SCRIPT = `
// 1. Hide navigator.webdriver
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined,
  configurable: true,
});

// 2. Fake chrome.runtime (Chromium detection)
if (!window.chrome) {
  window.chrome = {};
}
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    connect: function() {},
    sendMessage: function() {},
    onMessage: { addListener: function() {} },
    id: undefined,
  };
}

// 3. Fake chrome.csi and chrome.loadTimes
if (!window.chrome.csi) {
  window.chrome.csi = function() {
    return {
      startE: Date.now(),
      onloadT: Date.now() + 200,
      pageT: Date.now() + 300,
      tran: 15,
    };
  };
}
if (!window.chrome.loadTimes) {
  window.chrome.loadTimes = function() {
    return {
      requestTime: Date.now() / 1000,
      startLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000 + 0.1,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2',
    };
  };
}

// 4. Override Permissions API
const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
if (originalQuery) {
  window.navigator.permissions.query = function(parameters) {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission, onchange: null });
    }
    return originalQuery(parameters);
  };
}

// 5. Fake plugins & mimeTypes arrays
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const plugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ];
    plugins.length = 3;
    plugins.refresh = function() {};
    return plugins;
  },
  configurable: true,
});

Object.defineProperty(navigator, 'mimeTypes', {
  get: () => {
    const mimes = [
      { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: { name: 'Chrome PDF Plugin' } },
    ];
    mimes.length = 1;
    return mimes;
  },
  configurable: true,
});

// 6. Correct navigator.languages
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en'],
  configurable: true,
});

// 7. Hardware concurrency (don't report 0)
if (navigator.hardwareConcurrency < 2) {
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 4,
    configurable: true,
  });
}

// 8. WebGL vendor/renderer masking
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
  // UNMASKED_VENDOR_WEBGL
  if (parameter === 0x9245) {
    return 'Intel Inc.';
  }
  // UNMASKED_RENDERER_WEBGL
  if (parameter === 0x9246) {
    return 'Intel Iris OpenGL Engine';
  }
  return getParameter.call(this, parameter);
};

// Also patch WebGL2
if (typeof WebGL2RenderingContext !== 'undefined') {
  const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 0x9245) return 'Intel Inc.';
    if (parameter === 0x9246) return 'Intel Iris OpenGL Engine';
    return getParameter2.call(this, parameter);
  };
}

// 9. Canvas fingerprint noise
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
  const ctx = this.getContext('2d');
  if (ctx && this.width > 0 && this.height > 0) {
    const imageData = ctx.getImageData(0, 0, this.width, this.height);
    // Add subtle noise to a few pixels
    for (let i = 0; i < Math.min(10, imageData.data.length / 4); i++) {
      const idx = Math.floor(Math.random() * imageData.data.length / 4) * 4;
      imageData.data[idx] = imageData.data[idx] ^ 1;
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return originalToDataURL.call(this, type, quality);
};

// 10. Spoof connection info
if (navigator.connection) {
  Object.defineProperty(navigator.connection, 'rtt', { get: () => 50, configurable: true });
  Object.defineProperty(navigator.connection, 'downlink', { get: () => 10, configurable: true });
  Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g', configurable: true });
}
`;

/**
 * Apply all stealth patches to a Playwright page.
 * Call this BEFORE navigating to any URL.
 */
export async function applyStealthScripts(page: Page): Promise<void> {
  try {
    await page.addInitScript(STEALTH_INIT_SCRIPT);
  } catch (err) {
    logger.debug(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to apply stealth scripts (non-fatal)',
    );
  }
}

// All page.evaluate calls below use string expressions to avoid
// TypeScript errors about DOM globals (document, window) in a Node context.
// The strings are evaluated inside the browser, not in Node.

/**
 * Detect if a page is showing a Cloudflare challenge.
 * Checks for known Cloudflare challenge markers in the HTML.
 */
export async function isCloudflareChallenge(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(`(() => {
      const html = document.documentElement.innerHTML.toLowerCase();
      const markers = [
        'just a moment',
        'checking your browser',
        'cf-browser-verification',
        'cf_chl_opt',
        'challenge-platform',
        'ray id',
        'cloudflare',
        '__cf_chl_rt_tk',
      ];
      const matchCount = markers.filter(m => html.includes(m)).length;
      return matchCount >= 2;
    })()`) as boolean;
  } catch {
    return false;
  }
}

/**
 * Wait for a Cloudflare challenge to resolve.
 * Returns true if the challenge was solved (page navigated past it),
 * false if it timed out or couldn't be solved.
 */
export async function waitForCloudflareChallenge(
  page: Page,
  options: { timeout?: number; checkInterval?: number } = {},
): Promise<boolean> {
  const { timeout = 15_000, checkInterval = 1500 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const isCf = await isCloudflareChallenge(page);
    if (!isCf) {
      logger.debug('Cloudflare challenge resolved');
      return true;
    }

    // Try clicking the checkbox if visible (managed challenge)
    try {
      const checkbox = await page.$('input[type="checkbox"], .cf-turnstile iframe');
      if (checkbox) {
        await checkbox.click().catch(() => {});
        await page.waitForTimeout(2000);
      }
    } catch {
      // No interactive element — JS challenge solving itself
    }

    await page.waitForTimeout(checkInterval);
  }

  logger.warn('Cloudflare challenge did not resolve within timeout');
  return false;
}

/**
 * Detect if a page contains a CAPTCHA (generic, not Cloudflare-specific).
 */
export async function isCaptchaPresent(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(`(() => {
      const html = document.documentElement.innerHTML.toLowerCase();
      return (
        html.includes('recaptcha') ||
        html.includes('hcaptcha') ||
        html.includes('funcaptcha') ||
        html.includes('captcha-container') ||
        html.includes('g-recaptcha') ||
        !!document.querySelector('iframe[src*="recaptcha"]') ||
        !!document.querySelector('iframe[src*="hcaptcha"]')
      );
    })()`) as boolean;
  } catch {
    return false;
  }
}

/**
 * Pierce Shadow DOM to extract content from web components.
 * Returns the inner HTML of the shadow root's first matching selector,
 * or null if not found.
 */
export async function pierceShadowDom(
  page: Page,
  hostSelector: string,
  innerSelector?: string,
): Promise<string | null> {
  try {
    const host = JSON.stringify(hostSelector);
    const inner = innerSelector ? JSON.stringify(innerSelector) : 'null';
    return await page.evaluate(`(() => {
      const el = document.querySelector(${host});
      if (!el || !el.shadowRoot) return null;
      const inner = ${inner};
      if (!inner) return el.shadowRoot.innerHTML;
      const target = el.shadowRoot.querySelector(inner);
      return target ? target.innerHTML : null;
    })()`) as string | null;
  } catch {
    return null;
  }
}

/**
 * Simulate human-like scrolling behavior.
 * Scrolls down in increments with random delays to trigger lazy loading.
 */
export async function humanScroll(
  page: Page,
  options: { steps?: number; delayMin?: number; delayMax?: number } = {},
): Promise<void> {
  const { steps = 3, delayMin = 300, delayMax = 800 } = options;

  for (let i = 1; i <= steps; i++) {
    const fraction = i / steps;
    await page.evaluate(`window.scrollTo({ top: document.body.scrollHeight * ${fraction}, behavior: 'smooth' })`);

    const delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
    await page.waitForTimeout(delay);
  }
}

/**
 * Wait for network to settle — useful for AJAX-heavy pages.
 * Waits until no new requests are made for `quietMs` milliseconds.
 */
export async function waitForNetworkQuiet(
  page: Page,
  options: { quietMs?: number; timeout?: number } = {},
): Promise<void> {
  const { timeout = 15_000 } = options;

  await page.waitForLoadState('domcontentloaded');

  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // networkidle timed out — page may still be functional
  }
}
