import { isCancel, ThrottleError } from '@core/errors.js';

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  /** Injected sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** When aborted, stop retrying and re-throw immediately. */
  signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Detect whether an error indicates site-side throttling. */
export function isThrottle(e: unknown): boolean {
  if (e instanceof ThrottleError) return true;
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('cloudflare') ||
    msg.includes('just a moment') ||
    msg.includes('timeout')
  );
}

/**
 * Run `fn` with exponential backoff. Re-throws the last error if all fail.
 * A cancellation (abort) is never retried — it short-circuits immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    opts.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (e) {
      if (isCancel(e) || opts.signal?.aborted) throw e;
      lastErr = e;
      if (attempt === opts.attempts) break;
      await sleep(opts.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}
