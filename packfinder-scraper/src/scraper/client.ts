/**
 * HTTP Scraper Client with Browser Fingerprint Spoofing
 * Handles retries, rate limiting, and anti-detection measures
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import axiosRetry from 'axios-retry';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { logger } from './logger';
import {
  BrowserFingerprint,
  generateFingerprint,
  fingerprintToHeaders,
  getRandomDelay,
  generateReferer,
  FingerprintRotator,
} from './fingerprint';

export interface ScraperConfig {
  baseURL?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  useProxy?: boolean;
  proxyUrl?: string;
  rotateFingerprints?: boolean;
  respectRobotsTxt?: boolean;
  rateLimitMs?: number;
  sessionKey?: string;
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
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

/**
 * Rate limiter for controlling request frequency
 */
class RateLimiter {
  private lastRequestTime: number = 0;
  private minDelayMs: number;

  constructor(minDelayMs: number = 1000) {
    this.minDelayMs = minDelayMs;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const waitTime = Math.max(0, this.minDelayMs - timeSinceLastRequest);

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  setMinDelay(ms: number): void {
    this.minDelayMs = ms;
  }
}

/**
 * Main scraper client with anti-detection features
 */
export class ScraperClient {
  private client: AxiosInstance;
  private fingerprint: BrowserFingerprint;
  private fingerprintRotator: FingerprintRotator;
  private rateLimiter: RateLimiter;
  private config: Required<ScraperConfig>;
  private requestCount: number = 0;

  constructor(config: ScraperConfig = {}) {
    this.config = {
      baseURL: config.baseURL || '',
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 2000,
      useProxy: config.useProxy || false,
      proxyUrl: config.proxyUrl || '',
      rotateFingerprints: config.rotateFingerprints !== false,
      respectRobotsTxt: config.respectRobotsTxt !== false,
      rateLimitMs: config.rateLimitMs || 1500,
      sessionKey: config.sessionKey || 'default',
    };

    this.fingerprintRotator = new FingerprintRotator();
    this.fingerprint = this.fingerprintRotator.getFingerprint(this.config.sessionKey);
    this.rateLimiter = new RateLimiter(this.config.rateLimitMs);

    this.client = this.createAxiosInstance();
    this.setupRetryLogic();
  }

  private createAxiosInstance(): AxiosInstance {
    const headers = fingerprintToHeaders(this.fingerprint);

    const axiosConfig: AxiosRequestConfig = {
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    };

    if (this.config.useProxy && this.config.proxyUrl) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(this.config.proxyUrl);
    }

    return axios.create(axiosConfig);
  }

  private setupRetryLogic(): void {
    axiosRetry(this.client, {
      retries: this.config.retries,
      retryDelay: (retryCount) => {
        const delay = this.config.retryDelay * Math.pow(2, retryCount - 1);
        const jitter = Math.random() * 1000;
        return delay + jitter;
      },
      retryCondition: (error) => {
        // Retry on network errors or 5xx responses
        const shouldRetry = axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          (error.response?.status !== undefined && error.response.status >= 500);
        
        if (shouldRetry) {
          logger.warn({
            error: error.message,
            status: error.response?.status,
            retryCount: error.config?.['axios-retry']?.retryCount,
          }, 'Retrying request');
        }

        return shouldRetry;
      },
      onRetry: (retryCount, error) => {
        logger.debug({ retryCount, error: error.message }, 'Retry attempt');
      },
    });
  }

  /**
   * Rotate to a new fingerprint
   */
  rotateFingerprint(): void {
    if (this.config.rotateFingerprints) {
      this.fingerprint = this.fingerprintRotator.rotateFingerprint(this.config.sessionKey);
      this.client.defaults.headers = fingerprintToHeaders(this.fingerprint);
      logger.debug({ sessionKey: this.config.sessionKey }, 'Rotated fingerprint');
    }
  }

  /**
   * Make a GET request with anti-detection measures
   */
  async get<T = unknown>(
    url: string,
    options: {
      headers?: Record<string, string>;
      params?: Record<string, unknown>;
      referer?: string;
      rotateFingerprint?: boolean;
    } = {}
  ): Promise<ScrapedResponse<T>> {
    await this.rateLimiter.wait();

    if (options.rotateFingerprint || (this.requestCount > 0 && this.requestCount % 10 === 0)) {
      this.rotateFingerprint();
    }

    const fullUrl = url.startsWith('http') ? url : `${this.config.baseURL}${url}`;
    
    const requestHeaders: Record<string, string> = {
      ...this.client.defaults.headers as Record<string, string>,
      ...options.headers,
    };

    // Add referer if provided or generate one
    if (options.referer !== false) {
      requestHeaders['Referer'] = options.referer || generateReferer(fullUrl);
    }

    // Add random delay to simulate human behavior
    await new Promise(resolve => setTimeout(resolve, getRandomDelay(100, 800)));

    try {
      const response: AxiosResponse<T> = await this.client.get(url, {
        headers: requestHeaders,
        params: options.params,
      });

      this.requestCount++;

      // Handle common anti-bot responses
      if (response.status === 403) {
        throw new ScraperError('Access forbidden - likely blocked', 403, fullUrl, true);
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
    } catch (error) {
      if (error instanceof ScraperError) {
        throw error;
      }

      const axiosError = error as { response?: { status: number }; message: string };
      throw new ScraperError(
        axiosError.message || 'Request failed',
        axiosError.response?.status,
        fullUrl,
        axiosError.response?.status !== undefined && axiosError.response.status >= 500
      );
    }
  }

  /**
   * Make a POST request with anti-detection measures
   */
  async post<T = unknown>(
    url: string,
    data: unknown,
    options: {
      headers?: Record<string, string>;
      rotateFingerprint?: boolean;
    } = {}
  ): Promise<ScrapedResponse<T>> {
    await this.rateLimiter.wait();

    if (options.rotateFingerprint) {
      this.rotateFingerprint();
    }

    const fullUrl = url.startsWith('http') ? url : `${this.config.baseURL}${url}`;

    const requestHeaders: Record<string, string> = {
      ...this.client.defaults.headers as Record<string, string>,
      ...options.headers,
      'Content-Type': 'application/json',
    };

    try {
      const response: AxiosResponse<T> = await this.client.post(url, data, {
        headers: requestHeaders,
      });

      this.requestCount++;

      return {
        data: response.data,
        status: response.status,
        headers: response.headers as Record<string, string>,
        url: fullUrl,
        fingerprint: this.fingerprint,
        timestamp: new Date(),
      };
    } catch (error) {
      const axiosError = error as { response?: { status: number }; message: string };
      throw new ScraperError(
        axiosError.message || 'Request failed',
        axiosError.response?.status,
        fullUrl,
        axiosError.response?.status !== undefined && axiosError.response.status >= 500
      );
    }
  }

  /**
   * Update rate limit
   */
  setRateLimit(ms: number): void {
    this.rateLimiter.setMinDelay(ms);
    this.config.rateLimitMs = ms;
  }

  /**
   * Get current request count
   */
  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Reset request count
   */
  resetRequestCount(): void {
    this.requestCount = 0;
  }
}

/**
 * Create a new scraper client with the given config
 */
export function createScraper(config?: ScraperConfig): ScraperClient {
  return new ScraperClient(config);
}

/**
 * Batch scrape multiple URLs with concurrency control
 */
export async function batchScrape<T = unknown>(
  urls: string[],
  scraper: ScraperClient,
  options: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<Array<{ url: string; result: ScrapedResponse<T> | null; error: Error | null }>> {
  const { concurrency = 3, onProgress } = options;
  const results: Array<{ url: string; result: ScrapedResponse<T> | null; error: Error | null }> = [];
  
  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (url) => {
      try {
        const result = await scraper.get<T>(url);
        return { url, result, error: null };
      } catch (error) {
        return { url, result: null, error: error as Error };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + concurrency, urls.length), urls.length);
    }

    // Add delay between batches
    if (i + concurrency < urls.length) {
      await new Promise(resolve => setTimeout(resolve, getRandomDelay(2000, 5000)));
    }
  }

  return results;
}
