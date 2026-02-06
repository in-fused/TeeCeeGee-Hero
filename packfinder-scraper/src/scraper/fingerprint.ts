/**
 * Browser Fingerprint Spoofing Module
 * Generates realistic browser fingerprints to avoid detection
 */

import { randomUUID } from 'crypto';

// Realistic User-Agent rotation
const USER_AGENTS = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  // Chrome on Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  // Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  // Safari
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  // Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
];

// Accept-Language headers
const ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',
  'en-US,en;q=0.8,es;q=0.7',
  'en-GB,en;q=0.9,en-US;q=0.8',
  'en-CA,en;q=0.9,fr;q=0.8',
];

// Accept headers by content type
const ACCEPT_HEADERS = {
  html: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  json: 'application/json, text/plain, */*',
  api: 'application/json, text/javascript, */*; q=0.01',
};

// DNT (Do Not Track) values
const DNT_VALUES = ['0', '1', null];

// Sec-CH-UA headers (Client Hints)
const SEC_CH_UA = [
  '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  '"Not_A Brand";v="8", "Chromium";v="119", "Google Chrome";v="119"',
  '"Not_A Brand";v="99", "Google Chrome";v="119"',
];

// Screen resolutions
const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1680, height: 1050 },
];

// Timezone offsets
const TIMEZONE_OFFSETS = [-480, -420, -360, -300, -240, 0, 60, 120, 180, 480, 540];

export interface BrowserFingerprint {
  userAgent: string;
  accept: string;
  acceptLanguage: string;
  acceptEncoding: string;
  dnt: string | null;
  connection: string;
  upgradeInsecureRequests: string;
  secFetchDest: string;
  secFetchMode: string;
  secFetchSite: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  timezoneOffset: number;
  cookiesEnabled: boolean;
  sessionId: string;
}

export interface RequestConfig {
  headers: Record<string, string>;
  timeout: number;
  retries: number;
  retryDelay: number;
  followRedirects: boolean;
  maxRedirects: number;
}

/**
 * Generate a random browser fingerprint
 */
export function generateFingerprint(contentType: 'html' | 'json' | 'api' = 'html'): BrowserFingerprint {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const screenRes = SCREEN_RESOLUTIONS[Math.floor(Math.random() * SCREEN_RESOLUTIONS.length)];
  const isMobile = userAgent.includes('Mobile');
  
  // Parse platform from User-Agent
  let platform = '"Windows"';
  if (userAgent.includes('Macintosh')) platform = '"macOS"';
  else if (userAgent.includes('Linux')) platform = '"Linux"';
  else if (userAgent.includes('Android')) platform = '"Android"';
  
  return {
    userAgent,
    accept: ACCEPT_HEADERS[contentType],
    acceptLanguage: ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)],
    acceptEncoding: 'gzip, deflate, br',
    dnt: DNT_VALUES[Math.floor(Math.random() * DNT_VALUES.length)],
    connection: 'keep-alive',
    upgradeInsecureRequests: '1',
    secFetchDest: contentType === 'html' ? 'document' : 'empty',
    secFetchMode: contentType === 'html' ? 'navigate' : 'cors',
    secFetchSite: 'same-origin',
    secChUa: SEC_CH_UA[Math.floor(Math.random() * SEC_CH_UA.length)],
    secChUaMobile: isMobile ? '?1' : '?0',
    secChUaPlatform: platform,
    viewport: { width: screenRes.width, height: screenRes.height },
    screen: screenRes,
    timezoneOffset: TIMEZONE_OFFSETS[Math.floor(Math.random() * TIMEZONE_OFFSETS.length)],
    cookiesEnabled: true,
    sessionId: randomUUID(),
  };
}

/**
 * Convert fingerprint to Axios-compatible headers
 */
export function fingerprintToHeaders(fp: BrowserFingerprint): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': fp.userAgent,
    'Accept': fp.accept,
    'Accept-Language': fp.acceptLanguage,
    'Accept-Encoding': fp.acceptEncoding,
    'Connection': fp.connection,
    'Upgrade-Insecure-Requests': fp.upgradeInsecureRequests,
    'Sec-Fetch-Dest': fp.secFetchDest,
    'Sec-Fetch-Mode': fp.secFetchMode,
    'Sec-Fetch-Site': fp.secFetchSite,
    'sec-ch-ua': fp.secChUa,
    'sec-ch-ua-mobile': fp.secChUaMobile,
    'sec-ch-ua-platform': fp.secChUaPlatform,
    'Viewport-Width': String(fp.viewport.width),
    'DPR': '1',
    'X-Session-ID': fp.sessionId,
  };

  if (fp.dnt !== null) {
    headers['DNT'] = fp.dnt;
  }

  return headers;
}

/**
 * Generate a rotating fingerprint for session management
 */
export class FingerprintRotator {
  private fingerprints: Map<string, BrowserFingerprint> = new Map();
  private rotationInterval: number = 30 * 60 * 1000; // 30 minutes

  /**
   * Get or create a fingerprint for a session
   */
  getFingerprint(sessionKey: string, contentType: 'html' | 'json' | 'api' = 'html'): BrowserFingerprint {
    const existing = this.fingerprints.get(sessionKey);
    
    if (!existing) {
      const newFp = generateFingerprint(contentType);
      this.fingerprints.set(sessionKey, newFp);
      return newFp;
    }

    return existing;
  }

  /**
   * Rotate fingerprint for a session
   */
  rotateFingerprint(sessionKey: string, contentType: 'html' | 'json' | 'api' = 'html'): BrowserFingerprint {
    const newFp = generateFingerprint(contentType);
    this.fingerprints.set(sessionKey, newFp);
    return newFp;
  }

  /**
   * Remove a session's fingerprint
   */
  clearSession(sessionKey: string): void {
    this.fingerprints.delete(sessionKey);
  }

  /**
   * Clear all fingerprints
   */
  clearAll(): void {
    this.fingerprints.clear();
  }
}

// Global fingerprint rotator instance
export const fingerprintRotator = new FingerprintRotator();

/**
 * Generate realistic timing patterns to avoid bot detection
 */
export function getRandomDelay(min: number = 1000, max: number = 5000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simulate human-like mouse movement delays
 */
export function getMouseMovementDelay(): number {
  // Normal distribution around 150ms with 50ms std dev
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(50, Math.min(500, 150 + z * 50));
}

/**
 * Generate a realistic referer header
 */
export function generateReferer(targetUrl: string): string {
  const url = new URL(targetUrl);
  const referers = [
    'https://www.google.com/',
    'https://www.bing.com/',
    'https://search.yahoo.com/',
    'https://www.facebook.com/',
    'https://www.reddit.com/',
    `${url.protocol}//${url.hostname}/`,
  ];
  return referers[Math.floor(Math.random() * referers.length)];
}
