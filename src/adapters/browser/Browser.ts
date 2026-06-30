import type { Cookie } from '@core/types.js';

export interface LaunchOptions {
  headful: boolean;
}

/**
 * A live browser session: one isolated context the app can drive.
 * The app depends only on this interface, never on Camoufox directly.
 */
export interface BrowserSession {
  goto(url: string): Promise<string>;

  setCookies(cookies: Cookie[]): Promise<void>;

  html(): Promise<string>;

  postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<unknown>;

  resolveUsername(): Promise<string | null>;

  isLoggedIn(): Promise<boolean>;

  resolveDownloadUrl(filePageUrl: string): Promise<ResolvedDownload>;

  handToManager(nmmUrl: string): Promise<void>;

  close(): Promise<void>;
}

export interface ResolvedDownload {
  cdnUrl: string;
  cookieHeader: string;
  userAgent: string;
}

export interface Browser {
  launch(opts: LaunchOptions): Promise<BrowserSession>;
}
