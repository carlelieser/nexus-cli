import type { CookieQueryStrategy, ExportedCookie } from '@mherod/get-cookie';

import { AuthError } from '@core/errors.js';
import type { Cookie } from '@core/types.js';
import type { CookieSource } from './CookieSource.js';

/** Chromium variants get-cookie targets by name, sharing Chrome's cookie schema. */
const CHROMIUM_VARIANTS = [
  'chromium',
  'brave',
  'edge',
  'opera',
  'opera-gx',
  'vivaldi',
  'arc',
  'whale',
] as const;

type ChromiumVariant = (typeof CHROMIUM_VARIANTS)[number];

function isChromiumVariant(key: string): key is ChromiumVariant {
  return (CHROMIUM_VARIANTS as readonly string[]).includes(key);
}

/** Display names for the `--from` values we accept, for messages. */
const DISPLAY: Record<string, string> = {
  chrome: 'Chrome',
  chromium: 'Chromium',
  brave: 'Brave',
  edge: 'Edge',
  opera: 'Opera',
  'opera-gx': 'Opera GX',
  vivaldi: 'Vivaldi',
  arc: 'Arc',
  whale: 'Whale',
  firefox: 'Firefox',
  safari: 'Safari',
};

/**
 * Reads cookies directly from an installed browser via `@mherod/get-cookie`,
 * which handles each platform's encryption (macOS Keychain, Windows DPAPI,
 * Linux libsecret). Supports Chrome and its Chromium cousins, Firefox, and
 * Safari — the latter may prompt once for macOS Full Disk Access.
 */
export class BrowserCookieSource implements CookieSource {
  readonly browser: string;
  private readonly key: string;

  constructor(from: string) {
    this.key = from.toLowerCase();
    if (!(this.key in DISPLAY)) {
      throw new AuthError(
        `unsupported browser '${from}' (supported: ${Object.keys(DISPLAY).join(', ')})`,
      );
    }
    this.browser = DISPLAY[this.key]!;
  }

  async read(domainSuffix: string): Promise<Cookie[]> {
    const strategy = await strategyFor(this.key);
    let found: ExportedCookie[];
    try {
      // '%' is get-cookie's match-all name pattern; we want every cookie on the
      // domain, not one named cookie.
      found = await strategy.queryCookies('%', domainSuffix);
    } catch (e) {
      throw new AuthError(`could not read ${this.browser} cookies`, { cause: e });
    }
    return found.map(toCookie);
  }
}

/**
 * Map a `--from` value to its get-cookie strategy. Imports get-cookie lazily —
 * and only after silencing its dotenv banner — so the noise never reaches the
 * user and the dep isn't loaded for commands that don't read a browser.
 */
async function strategyFor(key: string): Promise<CookieQueryStrategy> {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const gc = await import('@mherod/get-cookie');
  if (key === 'chrome') return new gc.ChromeCookieQueryStrategy();
  if (key === 'firefox') return new gc.FirefoxCookieQueryStrategy();
  if (key === 'safari') return new gc.SafariCookieQueryStrategy();
  if (isChromiumVariant(key)) return new gc.ChromiumCookieQueryStrategy(key);
  // Unreachable: the constructor already rejected unknown keys.
  throw new AuthError(`unsupported browser '${key}'`);
}

/** Convert a get-cookie `ExportedCookie` into our Playwright-shaped `Cookie`. */
export function toCookie(c: ExportedCookie): Cookie {
  const cookie: Cookie = {
    name: c.name,
    value: String(c.value),
    domain: c.domain,
    path: c.meta?.path ?? '/',
  };
  if (c.meta?.secure !== undefined) cookie.secure = c.meta.secure;
  if (c.meta?.httpOnly !== undefined) cookie.httpOnly = c.meta.httpOnly;
  const expires = expiryToUnix(c.expiry);
  if (expires !== undefined) cookie.expires = expires;
  return cookie;
}

/** get-cookie reports expiry as a Date, unix-ish number, or "Infinity"; we need unix seconds. */
function expiryToUnix(expiry: ExportedCookie['expiry']): number | undefined {
  if (expiry === undefined || expiry === 'Infinity') return undefined;
  if (expiry instanceof Date) return Math.floor(expiry.getTime() / 1000);
  // A number: already seconds if it looks like seconds, else milliseconds.
  return expiry > 1e12 ? Math.floor(expiry / 1000) : expiry;
}
