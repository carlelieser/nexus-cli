import type {
  Browser,
  BrowserSession,
  LaunchOptions,
  ResolvedDownload,
} from '@adapters/browser/Browser.js';
import type { CookieSource } from '@adapters/cookies/CookieSource.js';
import type { Downloader } from '@adapters/download/Downloader.js';
import type { SessionStore } from '@adapters/session/SessionStore.js';
import type { Cookie, DownloadTarget, Session } from '@core/types.js';

/** A scriptable fake browser session. Maps URL → HTML. */
export class FakeSession implements BrowserSession {
  goneTo: string[] = [];
  resolved: string[] = [];
  seededCookies: Cookie[] = [];
  closed = false;
  loggedIn = true;
  /** Canned JSON returned by postJson (e.g. a GraphQL collection response). */
  jsonResponse: unknown = null;

  constructor(
    private readonly pages: Map<string, string> = new Map(),
    private readonly username: string | null = 'tester',
  ) {}

  setPage(url: string, html: string): this {
    this.pages.set(url, html);
    return this;
  }

  async goto(url: string): Promise<void> {
    this.goneTo.push(url);
  }
  async setCookies(cookies: Cookie[]): Promise<void> {
    this.seededCookies = cookies;
  }
  async isLoggedIn(): Promise<boolean> {
    return this.loggedIn;
  }
  async html(): Promise<string> {
    const last = this.goneTo.at(-1) ?? '';
    return this.pages.get(last) ?? '';
  }
  async postJson(): Promise<unknown> {
    return this.jsonResponse;
  }
  async resolveUsername(): Promise<string | null> {
    return this.username;
  }
  async resolveDownloadUrl(filePageUrl: string): Promise<ResolvedDownload> {
    this.resolved.push(filePageUrl);
    return {
      cdnUrl: `https://cdn.example/${encodeURIComponent(filePageUrl)}`,
      cookieHeader: 'sid=abc',
      userAgent: 'fake-agent',
    };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

export class FakeBrowser implements Browser {
  lastLaunch?: LaunchOptions;
  constructor(public session: FakeSession = new FakeSession()) {}
  async launch(opts: LaunchOptions): Promise<BrowserSession> {
    this.lastLaunch = opts;
    return this.session;
  }
}

export class FakeStore implements SessionStore {
  saved: Session | null = null;
  cleared = false;
  constructor(initial: Session | null = null) {
    this.saved = initial;
  }
  async save(s: Session): Promise<void> {
    this.saved = s;
  }
  async load(): Promise<Session | null> {
    return this.saved;
  }
  async clear(): Promise<void> {
    this.cleared = true;
    this.saved = null;
  }
}

export class FakeCookieSource implements CookieSource {
  readonly browser = 'FakeBrowser';
  constructor(private readonly cookies: Cookie[]) {}
  async read(): Promise<Cookie[]> {
    return this.cookies;
  }
}

/** Records fetches; can be told to fail for specific file ids. */
export class FakeDownloader implements Downloader {
  fetched: DownloadTarget[] = [];
  constructor(private readonly failFileIds: Set<number> = new Set()) {}
  async fetch(target: DownloadTarget, outDir: string): Promise<string> {
    if (this.failFileIds.has(target.fileId)) {
      throw new Error(`429 too many requests for file ${target.fileId}`);
    }
    this.fetched.push(target);
    return `${outDir}/file-${target.fileId}`;
  }
}

export const noSleep = async (): Promise<void> => {};
