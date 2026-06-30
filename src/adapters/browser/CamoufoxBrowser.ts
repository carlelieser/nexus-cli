import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Camoufox } from 'camoufox-js';
import type { BrowserContext, Page, Response } from 'playwright-core';

import { NetworkError } from '@core/errors.js';
import type { Cookie } from '@core/types.js';
import type { Browser, BrowserSession, LaunchOptions, ResolvedDownload } from './Browser.js';

const MAIN_HOST = 'www.nexusmods.com';
const ACCOUNT_URL = `https://${MAIN_HOST}/users/myaccount`;
const SIGN_IN_HOST = 'users.nexusmods.com';
const NEXUS_DOMAIN = '.nexusmods.com';

/** How long to wait for Camoufox to auto-solve a Cloudflare challenge. */
const CHALLENGE_TIMEOUT_MS = 25_000;

/**
 * Fallback cap for the GenerateDownloadUrl resolver POST. A real success or
 * failure response normally arrives in seconds; this only bounds the case where
 * the click never fired the request at all.
 */
const RESOLVE_TIMEOUT_MS = 60_000;

/** `page.goto`/`waitForNavigation` yield a Response, or null for same-document nav. */
type NavResponse = Response | null;

/**
 * Whether a navigation response is a Cloudflare challenge. Cloudflare sets
 * `cf-mitigated: challenge` on the interstitial response and omits it on the
 * real page — a deterministic protocol signal, so we never scrape page markup.
 */
function isChallenge(response: NavResponse): boolean {
  return response?.headers()['cf-mitigated'] === 'challenge';
}

/** Whether an error is Playwright's "execution context destroyed" mid-navigation. */
function isContextDestroyed(e: unknown): boolean {
  return e instanceof Error && /execution context was destroyed/i.test(e.message);
}

/** Camoufox-backed implementation of the Browser interface. */
export class CamoufoxBrowser implements Browser {
  async launch(opts: LaunchOptions): Promise<BrowserSession> {
    const userDataDir = await mkdtemp(join(tmpdir(), 'nexus-camoufox-'));
    const context = await Camoufox({
      headless: !opts.headful,
      user_data_dir: userDataDir,
      humanize: false,
      locale: 'en-US',
      firefox_user_prefs: {
        'network.protocol-handler.external.nxm': true,
        'network.protocol-handler.warn-external.nxm': false,
        'network.protocol-handler.expose.nxm': false,
      },
    });

    const page = context.pages()[0] ?? (await context.newPage());
    return new CamoufoxSession(context, page, userDataDir);
  }
}

class CamoufoxSession implements BrowserSession {
  constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly userDataDir: string,
  ) {}

  async goto(url: string): Promise<string> {
    await this.navigate(url);
    return this.page.url();
  }

  private async navigate(url: string): Promise<NavResponse> {
    let response: NavResponse;
    try {
      response = await this.page.goto(url, { waitUntil: 'commit' });
    } catch (e) {
      throw new NetworkError(`failed to load ${url}`, { cause: e });
    }

    const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
    while (isChallenge(response) && Date.now() < deadline) {
      response = await this.page
        .waitForNavigation({ waitUntil: 'commit', timeout: deadline - Date.now() })
        .catch(() => response);
    }

    await this.page
      .waitForLoadState('domcontentloaded', { timeout: 10_000 })
      .catch(() => undefined);
    return response;
  }

  async setCookies(cookies: Cookie[]): Promise<void> {
    await this.context.addCookies(
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || NEXUS_DOMAIN,
        path: c.path || '/',
        ...(c.expires !== undefined ? { expires: c.expires } : {}),
        ...(c.httpOnly !== undefined ? { httpOnly: c.httpOnly } : {}),
        ...(c.secure !== undefined ? { secure: c.secure } : {}),
        ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      })),
    );
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      await this.navigate(ACCOUNT_URL);
    } catch {
      return false;
    }
    if (new URL(this.page.url()).host === SIGN_IN_HOST) return false;
    const url = this.page.url();
    return url.includes('/users/') || url.includes('/settings');
  }

  async html(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
        return await this.page.content();
      } catch {
        await this.page.waitForTimeout(500);
      }
    }
    return this.page.content();
  }

  async postJson(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    if (new URL(this.page.url()).host !== MAIN_HOST) {
      await this.navigate(`https://${MAIN_HOST}/`).catch(() => undefined);
    }

    for (let attempt = 0; ; attempt++) {
      await this.page
        .waitForLoadState('domcontentloaded', { timeout: 10_000 })
        .catch(() => undefined);
      try {
        return await this.page.evaluate(
          async ({ url, body, headers }) => {
            const res = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json', ...headers },
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
            return res.json() as Promise<unknown>;
          },
          { url, body, headers },
        );
      } catch (e) {
        if (attempt >= 2 || !isContextDestroyed(e)) throw e;
      }
    }
  }

  async resolveUsername(): Promise<string | null> {
    await this.navigate(ACCOUNT_URL).catch(() => undefined);
    return this.page
      .evaluate(() => {
        const el =
          document.querySelector<HTMLElement>('[data-username]') ??
          document.querySelector<HTMLElement>('#login-name, .username');
        const ds = el?.dataset?.username;
        if (ds) return ds;
        const text = el?.textContent?.trim();
        return text && text.length > 0 ? text : null;
      })
      .catch(() => null);
  }

  async resolveDownloadUrl(filePageUrl: string): Promise<ResolvedDownload> {
    try {
      await this.navigate(filePageUrl);

      const slowButton = this.page.getByRole('button', { name: /slow download/i });
      await slowButton.waitFor({ state: 'visible', timeout: 30_000 });

      const respPromise = this.page.waitForResponse((r) => /GenerateDownloadUrl/i.test(r.url()), {
        timeout: RESOLVE_TIMEOUT_MS,
      });
      this.page.once('download', (d) => void d.cancel().catch(() => undefined));
      await slowButton.click();

      const resp = await respPromise;
      if (!resp.ok()) {
        throw new NetworkError(`download resolver returned HTTP ${resp.status()}`);
      }
      const cdnUrl = ((await resp.json()) as { url?: string }).url;
      if (!cdnUrl) throw new NetworkError('resolver returned no download URL');

      const cookieHeader = (await this.context.cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      const userAgent = await this.page.evaluate(() => navigator.userAgent);
      return { cdnUrl, cookieHeader, userAgent };
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      throw new NetworkError(`failed to resolve download for ${filePageUrl}`, {
        cause: e,
      });
    }
  }

  async handToManager(nmmUrl: string): Promise<void> {
    try {
      await this.navigate(nmmUrl);

      const slowButton = this.page.getByRole('button', { name: /slow download/i });
      await slowButton.waitFor({ state: 'visible', timeout: 30_000 });
      await slowButton.click();
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      throw new NetworkError(`failed to hand off download for ${nmmUrl}`, {
        cause: e,
      });
    }
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await rm(this.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
