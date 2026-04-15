/**
 * Authentication session manager for retailer scraping.
 *
 * Supports three authentication strategies (equivalent to the user's
 * seleniumbase + requests.Session() pattern, adapted for Node.js):
 *
 * 1. Manual cookie import — paste cookies from DevTools
 * 2. HTTP form login — for simple username/password forms
 * 3. Browser-based login — uses Playwright (optional dep) for complex
 *    flows: CAPTCHA, OAuth redirects, 2FA challenges.
 *
 * Once authenticated, cookies + headers are stored in Postgres and
 * injected into the ScraperClient (axios), just like passing cookies
 * to a requests.Session() object in Python.
 */

import { Pool } from 'pg';
import axios from 'axios';
import { logger } from '../lib/logger';
import {
  generateFingerprint,
  fingerprintToHeaders,
} from './fingerprint';
import type { AuthSession } from '../types/scraper';

export interface LoginCredentials {
  username: string;
  password: string;
  loginUrl: string;
  /** CSS selector for username field */
  usernameSelector?: string;
  /** CSS selector for password field */
  passwordSelector?: string;
  /** CSS selector for submit button */
  submitSelector?: string;
  /** URL to wait for after login (proves success) */
  successUrl?: string;
  /** Extra headers the site expects (from DevTools Network tab analysis) */
  extraHeaders?: Record<string, string>;
}

export class AuthSessionManager {
  constructor(private pool: Pool) {}

  /**
   * Strategy 1: Import cookies manually (pasted from DevTools / browser extension).
   * Equivalent to: session.cookies.update(parsed_cookies) in Python.
   */
  async importCookies(
    retailer: string,
    cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number }>,
    headers?: Record<string, string>,
    expiresInHours = 24,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + expiresInHours * 3600_000);
    await this.pool.query(
      `INSERT INTO scraper_auth_sessions (retailer, cookies, headers, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (retailer) DO UPDATE SET
         cookies = EXCLUDED.cookies,
         headers = EXCLUDED.headers,
         created_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      [retailer, JSON.stringify(cookies), JSON.stringify(headers || {}), expiresAt],
    );
    logger.info({ retailer, cookieCount: cookies.length }, 'Auth cookies imported');
  }

  /**
   * Strategy 2: HTTP form-based login.
   * Mimics Chrome DevTools observed requests: sends proper headers,
   * follows redirects, captures Set-Cookie from response.
   */
  async httpLogin(retailer: string, credentials: LoginCredentials): Promise<boolean> {
    const fp = generateFingerprint('html');
    const baseHeaders = {
      ...fingerprintToHeaders(fp),
      ...credentials.extraHeaders,
    };

    try {
      // Step 1: GET the login page to obtain any CSRF tokens / initial cookies
      const loginPageResp = await axios.get(credentials.loginUrl, {
        headers: baseHeaders,
        maxRedirects: 5,
        validateStatus: () => true,
      });

      // Extract Set-Cookie from login page
      const initialCookies = this.parseCookieHeaders(
        loginPageResp.headers['set-cookie'],
        credentials.loginUrl,
      );

      // Build cookie string for subsequent request
      const cookieHeader = initialCookies.map((c) => `${c.name}=${c.value}`).join('; ');

      // Step 2: POST credentials with cookies + headers matching what the site expects
      const postHeaders: Record<string, string> = {
        ...baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Referer: credentials.loginUrl,
        Origin: new URL(credentials.loginUrl).origin,
      };

      const formData = new URLSearchParams({
        [credentials.usernameSelector || 'username']: credentials.username,
        [credentials.passwordSelector || 'password']: credentials.password,
      });

      const loginResp = await axios.post(credentials.loginUrl, formData.toString(), {
        headers: postHeaders,
        maxRedirects: 5,
        validateStatus: () => true,
      });

      // Merge cookies from both responses
      const loginCookies = this.parseCookieHeaders(
        loginResp.headers['set-cookie'],
        credentials.loginUrl,
      );
      const allCookies = this.mergeCookies(initialCookies, loginCookies);

      const success =
        loginResp.status < 400 &&
        (!credentials.successUrl || loginResp.headers.location?.includes(credentials.successUrl));

      if (success && allCookies.length > 0) {
        await this.importCookies(retailer, allCookies, credentials.extraHeaders);
        logger.info({ retailer }, 'HTTP login successful');
        return true;
      }

      logger.warn({ retailer, status: loginResp.status }, 'HTTP login may have failed');
      return false;
    } catch (err) {
      logger.error({ err, retailer }, 'HTTP login failed');
      return false;
    }
  }

  /**
   * Strategy 3: Browser-based login using Playwright.
   * For complex auth flows (CAPTCHA, OAuth, 2FA).
   * Playwright is an optional dependency — fails gracefully if missing.
   *
   * Equivalent to:
   *   1. seleniumbase login + captcha bypass
   *   2. extract cookies
   *   3. pass to requests.Session()
   */
  async browserLogin(retailer: string, credentials: LoginCredentials): Promise<boolean> {
    try {
      // Dynamic import — Playwright is optional.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      let pw: any;
      try {
        pw = await (Function('return import("playwright")')() as Promise<any>);
      } catch {
        logger.warn('Playwright not installed — browser login unavailable. Install with: npm i playwright');
        return false;
      }

      const browser = await pw.chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: generateFingerprint('html').userAgent,
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
      });

      const page = await context.newPage();

      // Navigate to login page
      await page.goto(credentials.loginUrl, { waitUntil: 'networkidle' });

      // Fill credentials
      const userSel = credentials.usernameSelector || 'input[name="username"], input[type="email"], #username, #email';
      const passSel = credentials.passwordSelector || 'input[name="password"], input[type="password"], #password';
      const submitSel = credentials.submitSelector || 'button[type="submit"], input[type="submit"]';

      await page.fill(userSel, credentials.username);
      await page.fill(passSel, credentials.password);
      await page.click(submitSel);

      // Wait for navigation after login
      if (credentials.successUrl) {
        await page.waitForURL(`**${credentials.successUrl}**`, { timeout: 30_000 });
      } else {
        await page.waitForLoadState('networkidle');
      }

      // Extract all cookies from the authenticated browser context
      const browserCookies: any[] = await context.cookies();
      const cookies = browserCookies.map((c: any) => ({
        name: c.name as string,
        value: c.value as string,
        domain: c.domain as string,
        path: c.path as string,
        expires: c.expires > 0 ? (c.expires as number) : undefined,
      }));

      await browser.close();

      if (cookies.length > 0) {
        await this.importCookies(retailer, cookies, credentials.extraHeaders);
        logger.info({ retailer, cookieCount: cookies.length }, 'Browser login successful');
        return true;
      }

      return false;
    } catch (err) {
      logger.error({ err, retailer }, 'Browser login failed');
      return false;
    }
  }

  /**
   * Load a stored auth session for a retailer.
   * Returns null if expired or not found.
   */
  async getSession(retailer: string): Promise<AuthSession | null> {
    const result = await this.pool.query(
      `SELECT * FROM scraper_auth_sessions
       WHERE retailer = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [retailer],
    );

    if (!result.rows.length) return null;

    const row = result.rows[0];
    return {
      retailer: row.retailer,
      cookies: typeof row.cookies === 'string' ? JSON.parse(row.cookies) : row.cookies,
      headers: typeof row.headers === 'string' ? JSON.parse(row.headers) : row.headers,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    };
  }

  /** Build a Cookie header string from a stored session. */
  async getCookieHeader(retailer: string): Promise<string | null> {
    const session = await this.getSession(retailer);
    if (!session) return null;
    return session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /** Get merged headers (fingerprint + stored session headers). */
  async getAuthHeaders(retailer: string): Promise<Record<string, string>> {
    const session = await this.getSession(retailer);
    const fp = generateFingerprint('json');
    const headers = { ...fingerprintToHeaders(fp), ...(session?.headers || {}) };
    const cookie = await this.getCookieHeader(retailer);
    if (cookie) headers['Cookie'] = cookie;
    return headers;
  }

  /** Delete a stored session. */
  async clearSession(retailer: string): Promise<void> {
    await this.pool.query('DELETE FROM scraper_auth_sessions WHERE retailer = $1', [retailer]);
  }

  /** List all stored sessions. */
  async listSessions(): Promise<Array<{ retailer: string; createdAt: Date; expiresAt: Date | null }>> {
    const result = await this.pool.query(
      'SELECT retailer, created_at, expires_at FROM scraper_auth_sessions ORDER BY retailer',
    );
    return result.rows.map((r) => ({
      retailer: r.retailer,
      createdAt: new Date(r.created_at),
      expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    }));
  }

  // -- helpers --

  private parseCookieHeaders(
    setCookieHeaders: string | string[] | undefined,
    requestUrl: string,
  ): AuthSession['cookies'] {
    if (!setCookieHeaders) return [];
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const domain = new URL(requestUrl).hostname;
    return headers.map((h) => {
      const parts = h.split(';').map((p) => p.trim());
      const [nameVal] = parts;
      const eqIdx = nameVal.indexOf('=');
      return {
        name: nameVal.substring(0, eqIdx),
        value: nameVal.substring(eqIdx + 1),
        domain,
        path: '/',
      };
    });
  }

  private mergeCookies(
    ...lists: AuthSession['cookies'][]
  ): AuthSession['cookies'] {
    const map = new Map<string, AuthSession['cookies'][0]>();
    for (const list of lists) {
      for (const c of list) {
        map.set(`${c.domain}:${c.name}`, c);
      }
    }
    return Array.from(map.values());
  }
}
