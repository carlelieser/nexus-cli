import type { Cookie } from '@core/types.js';

/** Launch options for a browser. */
export interface LaunchOptions {
  /** Show a real window. Headless is the norm for cookie-seeded downloads. */
  headful: boolean;
}

/**
 * A live browser session: one isolated context the app can drive.
 * The app depends only on this interface, never on Camoufox directly.
 */
export interface BrowserSession {
  /**
   * Navigate to a URL, wait for it to settle (and any Cloudflare challenge to
   * clear), and return the final landed URL — which differs from `url` when the
   * site redirects (e.g. an expired session bounced to the sign-in host).
   */
  goto(url: string): Promise<string>;

  /** Seed cookies into the context to restore an imported session. */
  setCookies(cookies: Cookie[]): Promise<void>;

  /** Current page HTML, for scraping. */
  html(): Promise<string>;

  /**
   * Execute an authenticated JSON POST from within the page context (so the
   * session cookies and origin travel with it) and return the parsed body.
   * Used for Nexus's GraphQL API.
   */
  postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<unknown>;

  /** Resolve the logged-in Nexus username from the current page, if any. */
  resolveUsername(): Promise<string | null>;

  /**
   * Whether the seeded cookies authenticate us to Nexus. Navigates to the
   * account page and inspects the result; used to validate an imported session.
   */
  isLoggedIn(): Promise<boolean>;

  /**
   * Resolve a file's signed CDN download URL by driving the manual "Slow
   * download" flow on its files page, and return everything Node needs to
   * stream it directly (the in-page fetch is blocked by CORS on the CDN host;
   * Node has no CORS restriction).
   */
  resolveDownloadUrl(filePageUrl: string): Promise<ResolvedDownload>;

  /** Close this session and free its resources. */
  close(): Promise<void>;
}

/** A resolved, signed CDN URL plus the credentials to fetch it from Node. */
export interface ResolvedDownload {
  /** Signed CDN URL (single-use, short-lived). */
  cdnUrl: string;
  /** Cookie header to replay (the URL is signed, but harmless to include). */
  cookieHeader: string;
  /** The context's user-agent, for a consistent request. */
  userAgent: string;
}

export interface Browser {
  launch(opts: LaunchOptions): Promise<BrowserSession>;
}
