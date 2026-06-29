import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Camoufox } from 'camoufox-js';
import type { BrowserContext, Page } from 'playwright-core';

import { NetworkError } from '@core/errors.js';
import type { Cookie } from '@core/types.js';
import type { Browser, BrowserSession, LaunchOptions, ResolvedDownload } from './Browser.js';

const ACCOUNT_URL = 'https://www.nexusmods.com/users/myaccount';
const SIGN_IN_HOST = 'users.nexusmods.com';
const NEXUS_DOMAIN = '.nexusmods.com';

/** Camoufox-backed implementation of the Browser interface. */
export class CamoufoxBrowser implements Browser {
  async launch(opts: LaunchOptions): Promise<BrowserSession> {
    // Auth comes from imported cookies, so a throwaway profile is fine. Passing
    // user_data_dir makes Camoufox return a fully-configured BrowserContext —
    // we must NOT call newContext() ourselves (Camoufox's patched Firefox
    // rejects Playwright's setDefaultViewport).
    const userDataDir = await mkdtemp(join(tmpdir(), 'nexus-camoufox-'));
    const context = await Camoufox({
      headless: !opts.headful,
      user_data_dir: userDataDir,
      os: 'macos',
      humanize: true,
      // Pin locale to match the imported session's origin. geoip is left OFF:
      // when it resolved to a different region than the session cookies, the
      // fingerprint/cookie mismatch triggered a hard Cloudflare challenge.
      locale: 'en-US',
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

  async goto(url: string): Promise<void> {
    try {
      // `commit` resolves as soon as the response starts — we don't block on a
      // heavy page's trailing resources. Readiness is decided by settleChallenge.
      await this.page.goto(url, { waitUntil: 'commit' });
    } catch (e) {
      throw new NetworkError(`failed to load ${url}`, { cause: e });
    }
    await this.settleChallenge();
  }

  /**
   * Wait until the page is usable. Two cases:
   *  - No Cloudflare challenge: returns as soon as the document has a body
   *    (typically the first poll — no artificial delay).
   *  - Challenge present: Camoufox clears the non-interactive "just a moment"
   *    interstitial on its own after a few seconds; we wait for the
   *    challenge-platform markers to disappear before callers scrape.
   * Either way it gives up after `timeoutMs` and lets the caller proceed.
   */
  private async settleChallenge(timeoutMs = 25_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.page
        .evaluate(() => {
          const html = document.documentElement.outerHTML.toLowerCase();
          const onChallenge =
            html.includes('cdn-cgi/challenge-platform') ||
            html.includes('cf_chl_opt') ||
            !!document.getElementById('challenge-running');
          // `interactive` means the full document has been parsed (static HTML,
          // incl. the files-page rows, is present) — without waiting on the
          // trailing subresources that `domcontentloaded` blocks on.
          const parsed = document.readyState !== 'loading';
          return { onChallenge, parsed };
        })
        .catch(() => ({ onChallenge: false, parsed: true }));
      // Ready when there's no challenge and the document has been parsed.
      if (!state.onChallenge && state.parsed) return;
      await this.page.waitForTimeout(500);
    }
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
      await this.page.goto(ACCOUNT_URL, { waitUntil: 'commit' });
    } catch {
      return false;
    }
    await this.settleChallenge();
    // The account URL redirects to /settings or /users/... when authenticated,
    // and to the sign-in host when not.
    if (new URL(this.page.url()).host === SIGN_IN_HOST) return false;
    const url = this.page.url();
    return url.includes('/users/') || url.includes('/settings');
  }

  async html(): Promise<string> {
    // `content()` throws if the page is mid-navigation (the `commit`-based goto
    // can return while a redirect is still settling). Wait for the DOM to be
    // ready and retry a couple of times before giving up.
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
    // Run fetch INSIDE the page so cookies + origin (nexusmods.com) apply —
    // required for the GraphQL endpoint to accept the request.
    return this.page.evaluate(
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
  }

  async resolveUsername(): Promise<string | null> {
    await this.page.goto(ACCOUNT_URL, { waitUntil: 'commit' }).catch(() => undefined);
    await this.settleChallenge();
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
      // The manual-download page renders a <mod-file-download> web component
      // whose "Slow download" button (in an open shadow root) triggers a POST
      // to GenerateDownloadUrl that returns the signed CDN URL. We drive that
      // button (the trusted path that clears Cloudflare) and capture the
      // resolver's JSON response — then Node streams the URL itself.
      await this.page.goto(filePageUrl, { waitUntil: 'commit' });
      await this.settleChallenge();

      const slowButton = this.page.getByRole('button', { name: /slow download/i });
      await slowButton.waitFor({ state: 'visible', timeout: 30_000 });

      const respPromise = this.page.waitForResponse(
        (r) =>
          /GenerateDownloadUrl/i.test(r.url()) &&
          r.status() === 200 &&
          /json/i.test(r.headers()['content-type'] ?? ''),
        { timeout: 120_000 },
      );
      // We don't want the native download — cancel it; we stream the URL.
      this.page.once('download', (d) => void d.cancel().catch(() => undefined));
      await slowButton.click();

      const resp = await respPromise;
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

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await rm(this.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
