/**
 * HTTP scraper client with anti-detection.
 * Handles fingerprint rotation, rate limiting, retries, and
 * authenticated session cookie injection.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from '../lib/logger';
import {
  BrowserFingerprint,
  FingerprintRotator,
  fingerprintToHeaders,
  getRandomDelay,
  generateReferer,
} from './fingerprint';

export interface ScraperClientConfig {
  baseURL?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  rateLimitMs?: number;
  sessionKey?: string;
  /** Pre-injected cookies (like requests.Session().cookies) */
  cookies?: string;
  /** Extra headers to persist across requests (from DevTools analysis) */
  persistentHeaders?: Record<string, string>;
}

export interface ScrapedResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
  url: string;
  fingerprint: BrowserFingerprint;
  timestamp: Date;
}

export class ScraperError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

class RateLimiter {
  private lastRequestTime = 0;
  constructor(private minDelayMs: number) {}

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    const remaining = Math.max(0, this.minDelayMs - elapsed);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    this.lastRequestTime = Date.now();
  }

  setMinDelay(ms: number): void {
    this.minDelayMs = ms;
  }
}

export class ScraperClient {
  private client: AxiosInstance;
  private fingerprint: BrowserFingerprint;
  private rotator: FingerprintRotator;
  private limiter: RateLimiter;
  private config: Required<ScraperClientConfig>;
  private requestCount = 0;

  constructor(config: ScraperClientConfig = {}) {
    this.config = {
      baseURL: config.baseURL || '',
      timeout: config.timeout || 30_000,
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 2000,
      rateLimitMs: config.rateLimitMs || 1500,
      sessionKey: config.sessionKey || 'default',
      cookies: config.cookies || '',
      persistentHeaders: config.persistentHeaders || {},
    };

    this.rotator = new FingerprintRotator();
    this.fingerprint = this.rotator.get(this.config.sessionKey);
    this.limiter = new RateLimiter(this.config.rateLimitMs);
    this.client = this.createAxios();
  }

  private createAxios(): AxiosInstance {
    const headers: Record<string, string> = {
      ...fingerprintToHeaders(this.fingerprint),
      ...this.config.persistentHeaders,
    };
    if (this.config.cookies) {
      headers['Cookie'] = this.config.cookies;
    }

    return axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });
  }

  /** Inject authenticated cookies (like session.cookies in Python). */
  setCookies(cookieString: string): void {
    this.config.cookies = cookieString;
    this.client.defaults.headers['Cookie'] = cookieString;
  }

  /** Inject extra headers (matching what DevTools shows the site expects). */
  setExtraHeaders(headers: Record<string, string>): void {
    Object.assign(this.config.persistentHeaders, headers);
    Object.assign(this.client.defaults.headers, headers);
  }

  rotateFingerprint(): void {
    this.fingerprint = this.rotator.rotate(this.config.sessionKey);
    const fpHeaders = fingerprintToHeaders(this.fingerprint);
    // Preserve cookies + persistent headers through rotation
    Object.assign(this.client.defaults.headers, fpHeaders);
  }

  async get<T = unknown>(
    url: string,
    options: {
      headers?: Record<string, string>;
      params?: Record<string, unknown>;
      referer?: string | false;
    } = {},
  ): Promise<ScrapedResponse<T>> {
    await this.limiter.wait();

    // Rotate fingerprint every 10 requests
    if (this.requestCount > 0 && this.requestCount % 10 === 0) {
      this.rotateFingerprint();
    }

    const fullUrl = url.startsWith('http') ? url : `${this.config.baseURL}${url}`;
    const reqHeaders: Record<string, string> = {
      ...(this.client.defaults.headers as Record<string, string>),
      ...options.headers,
    };
    if (options.referer !== false) {
      reqHeaders['Referer'] = options.referer || generateReferer(fullUrl);
    }

    // Small human-like jitter
    await new Promise((r) => setTimeout(r, getRandomDelay(50, 300)));

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response: AxiosResponse<T> = await this.client.get(url, {
          headers: reqHeaders,
          params: options.params,
        });
        this.requestCount++;

        if (response.status === 403) {
          throw new ScraperError('Access forbidden — likely blocked', 403, fullUrl, true);
        }
        if (response.status === 429) {
          throw new ScraperError('Rate limited', 429, fullUrl, true);
        }
        if (response.status >= 400) {
          throw new ScraperError(`HTTP ${response.status}`, response.status, fullUrl, false);
        }

        return {
          data: response.data,
          status: response.status,
          headers: response.headers as Record<string, string>,
          url: fullUrl,
          fingerprint: this.fingerprint,
          timestamp: new Date(),
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const retryable =
          err instanceof ScraperError ? err.retryable : true;
        if (!retryable || attempt === this.config.retries) break;

        const delay = this.config.retryDelay * Math.pow(2, attempt) + Math.random() * 1000;
        logger.debug({ attempt: attempt + 1, delay, url: fullUrl }, 'Retrying scrape request');
        await new Promise((r) => setTimeout(r, delay));
        this.rotateFingerprint();
      }
    }

    if (lastError instanceof ScraperError) throw lastError;
    throw new ScraperError(
      lastError?.message || 'Request failed',
      undefined,
      fullUrl,
      false,
    );
  }

  async post<T = unknown>(
    url: string,
    data: unknown,
    options: { headers?: Record<string, string> } = {},
  ): Promise<ScrapedResponse<T>> {
    await this.limiter.wait();

    const reqHeaders: Record<string, string> = {
      ...(this.client.defaults.headers as Record<string, string>),
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response: AxiosResponse<T> = await this.client.post(url, data, {
      headers: reqHeaders,
    });
    this.requestCount++;

    return {
      data: response.data,
      status: response.status,
      headers: response.headers as Record<string, string>,
      url: url.startsWith('http') ? url : `${this.config.baseURL}${url}`,
      fingerprint: this.fingerprint,
      timestamp: new Date(),
    };
  }

  setRateLimit(ms: number): void {
    this.limiter.setMinDelay(ms);
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  resetRequestCount(): void {
    this.requestCount = 0;
  }
}
