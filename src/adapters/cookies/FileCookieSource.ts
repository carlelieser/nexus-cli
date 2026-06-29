import { readFile } from 'node:fs/promises';

import { AuthError } from '@core/errors.js';
import type { Cookie } from '@core/types.js';
import type { CookieSource } from './CookieSource.js';

/**
 * Reads cookies from a file exported by a browser extension — an alternative to
 * reading the browser's store directly ({@link BrowserCookieSource}) for users
 * who would rather export a file than grant cookie-store access.
 *
 * Auto-detects the two shapes such extensions emit:
 *  - a **JSON array** (Cookie-Editor / EditThisCookie style), or
 *  - the **Netscape `cookies.txt`** tab-delimited format (curl/wget style).
 */
export class FileCookieSource implements CookieSource {
  readonly browser: string;

  constructor(private readonly path: string) {
    this.browser = `file ${path}`;
  }

  async read(domainSuffix: string): Promise<Cookie[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (e) {
      throw new AuthError(`could not read cookie file ${this.path}`, { cause: e });
    }

    const cookies = looksLikeJson(raw) ? parseJson(raw, this.path) : parseNetscape(raw);
    return cookies.filter((c) => hostMatches(c.domain, domainSuffix));
  }
}

/** A leading `[` or `{` (after whitespace) marks a JSON export; otherwise Netscape. */
function looksLikeJson(raw: string): boolean {
  return /^\s*[[{]/.test(raw);
}

interface JsonCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  /** Extensions name expiry either `expirationDate` (Cookie-Editor) or `expires`. */
  expirationDate?: number;
  expires?: number;
}

function parseJson(raw: string, path: string): Cookie[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new AuthError(`cookie file ${path} is not valid JSON`, { cause: e });
  }
  // Accept a bare array or a `{ cookies: [...] }` wrapper.
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { cookies?: unknown }).cookies)
      ? (data as { cookies: unknown[] }).cookies
      : null;
  if (!arr) {
    throw new AuthError(`cookie file ${path} is not a JSON cookie array`);
  }

  const cookies: Cookie[] = [];
  for (const entry of arr) {
    const c = entry as JsonCookie;
    if (!c.name || c.value === undefined || !c.domain) continue;
    const expires = c.expirationDate ?? c.expires;
    cookies.push({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
      sameSite: sameSiteOf(c.sameSite),
      ...(typeof expires === 'number' && expires > 0 ? { expires: Math.floor(expires) } : {}),
    });
  }
  return cookies;
}

/**
 * Netscape `cookies.txt`: tab-delimited
 * `domain  includeSubdomains  path  secure  expires  name  value`.
 * Lines starting with `#` are comments, except the `#HttpOnly_` prefix some
 * tools prepend to the domain field.
 */
function parseNetscape(raw: string): Cookie[] {
  const cookies: Cookie[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_'))) continue;

    const f = trimmed.split('\t');
    if (f.length < 7) continue;

    let domain = f[0]!;
    let httpOnly = false;
    if (domain.startsWith('#HttpOnly_')) {
      domain = domain.slice('#HttpOnly_'.length);
      httpOnly = true;
    }

    const expires = Number(f[4]);
    const cookie: Cookie = {
      name: f[5]!,
      value: f[6]!,
      domain,
      path: f[2] ?? '/',
      secure: f[3]!.toUpperCase() === 'TRUE',
      httpOnly,
      sameSite: 'Lax',
    };
    if (Number.isFinite(expires) && expires > 0) cookie.expires = expires;
    cookies.push(cookie);
  }
  return cookies;
}

/** Map an extension's `sameSite` string to Playwright's enum; default `Lax`. */
function sameSiteOf(v: string | undefined): 'Strict' | 'Lax' | 'None' {
  switch (v?.toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'no_restriction':
    case 'none':
      return 'None';
    default:
      return 'Lax';
  }
}

/** Whether a cookie's host belongs to `suffix` (exact or a subdomain). */
function hostMatches(domain: string, suffix: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase();
  const s = suffix.toLowerCase();
  return host === s || host.endsWith(`.${s}`);
}
