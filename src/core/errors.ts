/**
 * Typed, recoverable errors. The CLI renders these as concise one-line
 * messages (no stack trace unless --verbose).
 */

export abstract class NexusError extends Error {
  abstract readonly kind: string;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
  }
}

/** Session is missing, invalid, or expired; the user must re-login. */
export class AuthError extends NexusError {
  readonly kind = 'auth';
}

/** A page could not be parsed into the expected domain shape. */
export class ScrapeError extends NexusError {
  readonly kind = 'scrape';
}

/** A file download failed after exhausting retries. */
export class DownloadError extends NexusError {
  readonly kind = 'download';
}

/** A transient network/transport failure. */
export class NetworkError extends NexusError {
  readonly kind = 'network';
}

/** The site is signalling throttling (HTTP 429 / Cloudflare challenge). */
export class ThrottleError extends NexusError {
  readonly kind = 'throttle';
}

export function isNexusError(e: unknown): e is NexusError {
  return e instanceof NexusError;
}

export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
