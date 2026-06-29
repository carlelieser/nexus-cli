import { CamoufoxBrowser } from '@adapters/browser/CamoufoxBrowser.js';
import { BrowserCookieSource } from '@adapters/cookies/BrowserCookieSource.js';
import type { CookieSource } from '@adapters/cookies/CookieSource.js';
import { FileCookieSource } from '@adapters/cookies/FileCookieSource.js';
import { BrowserDownloader } from '@adapters/download/BrowserDownloader.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';
import { FileSessionStore } from '@adapters/session/FileSessionStore.js';
import type { Opener } from '@app/downloadMod.js';
import open from 'open';

/**
 * Composition root: the only place concrete adapters are constructed. Commands
 * receive these via their handlers; the app layer never imports them.
 */
export function buildDeps() {
  const opener: Opener = async (url) => {
    await open(url);
  };
  return {
    browser: new CamoufoxBrowser(),
    store: new FileSessionStore(),
    site: new NexusWebAdapter(),
    downloader: new BrowserDownloader(),
    opener,
  };
}

export type Deps = ReturnType<typeof buildDeps>;

/** Domain suffix for Nexus cookies. */
export const NEXUS_COOKIE_DOMAIN = 'nexusmods.com';

/** Resolve a cookie source by browser name. */
export function cookieSourceFor(browser: string): CookieSource {
  return new BrowserCookieSource(browser);
}

/** Resolve a cookie source from an exported cookie file (--file). */
export function fileCookieSource(path: string): CookieSource {
  return new FileCookieSource(path);
}
