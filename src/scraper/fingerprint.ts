/**
 * Browser fingerprint spoofing for anti-detection.
 * Generates realistic browser headers to avoid bot detection.
 */

import { randomUUID } from 'crypto';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
];

const ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',
  'en-US,en;q=0.8,es;q=0.7',
  'en-GB,en;q=0.9,en-US;q=0.8',
];

const ACCEPT_HEADERS: Record<string, string> = {
  html: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  json: 'application/json, text/plain, */*',
  api: 'application/json, text/javascript, */*; q=0.01',
};

const SEC_CH_UA = [
  '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  '"Not_A Brand";v="8", "Chromium";v="119", "Google Chrome";v="119"',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface BrowserFingerprint {
  userAgent: string;
  accept: string;
  acceptLanguage: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  sessionId: string;
}

export function generateFingerprint(contentType: 'html' | 'json' | 'api' = 'html'): BrowserFingerprint {
  const userAgent = pick(USER_AGENTS);
  let platform = '"Windows"';
  if (userAgent.includes('Macintosh')) platform = '"macOS"';
  else if (userAgent.includes('Linux')) platform = '"Linux"';

  return {
    userAgent,
    accept: ACCEPT_HEADERS[contentType],
    acceptLanguage: pick(ACCEPT_LANGUAGES),
    secChUa: pick(SEC_CH_UA),
    secChUaMobile: '?0',
    secChUaPlatform: platform,
    sessionId: randomUUID(),
  };
}

export function fingerprintToHeaders(fp: BrowserFingerprint): Record<string, string> {
  return {
    'User-Agent': fp.userAgent,
    Accept: fp.accept,
    'Accept-Language': fp.acceptLanguage,
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': fp.accept.includes('text/html') ? 'document' : 'empty',
    'Sec-Fetch-Mode': fp.accept.includes('text/html') ? 'navigate' : 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'sec-ch-ua': fp.secChUa,
    'sec-ch-ua-mobile': fp.secChUaMobile,
    'sec-ch-ua-platform': fp.secChUaPlatform,
  };
}

/** Manages per-session fingerprint rotation. */
export class FingerprintRotator {
  private fingerprints = new Map<string, BrowserFingerprint>();

  get(sessionKey: string, contentType: 'html' | 'json' | 'api' = 'html'): BrowserFingerprint {
    const existing = this.fingerprints.get(sessionKey);
    if (existing) return existing;
    const fp = generateFingerprint(contentType);
    this.fingerprints.set(sessionKey, fp);
    return fp;
  }

  rotate(sessionKey: string, contentType: 'html' | 'json' | 'api' = 'html'): BrowserFingerprint {
    const fp = generateFingerprint(contentType);
    this.fingerprints.set(sessionKey, fp);
    return fp;
  }

  clear(sessionKey: string): void {
    this.fingerprints.delete(sessionKey);
  }
}

export function getRandomDelay(min = 1000, max = 5000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateReferer(targetUrl: string): string {
  const url = new URL(targetUrl);
  const referers = [
    'https://www.google.com/',
    'https://www.bing.com/',
    `${url.protocol}//${url.hostname}/`,
  ];
  return pick(referers);
}
