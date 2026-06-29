import type { Browser, BrowserSession } from '../adapters/browser/Browser.js';
import type { SessionStore } from '../adapters/session/SessionStore.js';
import { AuthError } from '../core/errors.js';

export interface RestoreDeps {
  browser: Browser;
  store: SessionStore;
}

/**
 * Launch a browser and seed it with the imported session cookies. Throws
 * {@link AuthError} (→ exit code 2) when no session is stored. The caller owns
 * closing the returned session.
 */
export async function restoreSession(deps: RestoreDeps, headful: boolean): Promise<BrowserSession> {
  const saved = await deps.store.load();
  if (!saved) {
    throw new AuthError('no saved session — run `nexus import --from chrome` first');
  }
  const session = await deps.browser.launch({ headful });
  await session.setCookies(saved.cookies);

  // Visit the account page first: this validates the session AND warms the
  // context past Cloudflare's challenge before any deep mod-page navigation
  // (a cold jump straight to a files page is more likely to be challenged).
  if (!(await session.isLoggedIn())) {
    await session.close();
    throw new AuthError('session expired — run `nexus import --from chrome` again');
  }
  return session;
}
