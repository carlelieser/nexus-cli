import type { Cookie } from '@core/types.js';

/** Reads cookies for a domain out of an installed browser's cookie store. */
export interface CookieSource {
  /** Human-readable name of the browser, for messages. */
  readonly browser: string;

  /** Read and decrypt all cookies whose host matches `domainSuffix`. */
  read(domainSuffix: string): Promise<Cookie[]>;
}
