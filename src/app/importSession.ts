import type { Browser } from '../adapters/browser/Browser.js';
import type { CookieSource } from '../adapters/cookies/CookieSource.js';
import type { SessionStore } from '../adapters/session/SessionStore.js';
import { AuthError } from '../core/errors.js';
import type { Session } from '../core/types.js';

export interface ImportDeps {
  source: CookieSource;
  browser: Browser;
  store: SessionStore;
}

export interface ImportParams {
  /** Cookie host suffix to import (e.g. `nexusmods.com`). */
  domainSuffix: string;
  /** Validate the cookies authenticate before saving. */
  validate: boolean;
}

/**
 * Import Nexus cookies from the user's real browser, optionally verify they
 * authenticate, and persist them as the session. No interactive login — the
 * user already cleared Cloudflare + signed in via their normal browser.
 */
export async function importSession(deps: ImportDeps, params: ImportParams): Promise<Session> {
  const cookies = await deps.source.read(params.domainSuffix);
  if (cookies.length === 0) {
    throw new AuthError(
      `no ${params.domainSuffix} cookies found in ${deps.source.browser} — ` +
        'log into Nexus there first',
    );
  }

  let username = 'nexus-user';
  if (params.validate) {
    const session = await deps.browser.launch({ headful: false });
    try {
      await session.setCookies(cookies);
      if (!(await session.isLoggedIn())) {
        throw new AuthError(`imported ${deps.source.browser} cookies are not logged in to Nexus`);
      }
      username = (await session.resolveUsername()) ?? username;
    } finally {
      await session.close();
    }
  }

  const saved: Session = {
    username,
    cookies,
    capturedAt: new Date().toISOString(),
  };
  await deps.store.save(saved);
  return saved;
}
