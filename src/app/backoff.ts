/**
 * Adaptive pacing for collection downloads. Pure, side-effect-free state
 * machine so it can be unit-tested without a browser.
 *
 * Starts fast (no delay, full concurrency). On a throttle signal it inserts
 * and progressively grows an inter-mod delay and reduces effective
 * concurrency. After a run of clean successes it relaxes back toward fast.
 */

export interface BackoffConfig {
  /** Configured ceiling for concurrency (the user's --concurrency). */
  maxConcurrency: number;
  /** Delay added on the first throttle signal (ms). */
  baseDelayMs: number;
  /** Hard cap on inter-mod delay (ms). */
  maxDelayMs: number;
  /** Clean successes required before relaxing one step. */
  relaxAfter: number;
}

export const DEFAULT_BACKOFF: Omit<BackoffConfig, 'maxConcurrency'> = {
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  relaxAfter: 5,
};

export class BackoffPolicy {
  private delayMs = 0;
  private concurrency: number;
  private cleanStreak = 0;
  private readonly cfg: BackoffConfig;

  constructor(cfg: BackoffConfig) {
    this.cfg = cfg;
    this.concurrency = cfg.maxConcurrency;
  }

  /** Current inter-mod delay to wait before starting the next member. */
  get currentDelayMs(): number {
    return this.delayMs;
  }

  /** Current effective concurrency. */
  get currentConcurrency(): number {
    return this.concurrency;
  }

  /** Record a throttle signal (429 / Cloudflare / repeated timeout). */
  onThrottle(): void {
    this.cleanStreak = 0;
    this.delayMs =
      this.delayMs === 0 ? this.cfg.baseDelayMs : Math.min(this.delayMs * 2, this.cfg.maxDelayMs);
    this.concurrency = Math.max(1, this.concurrency - 1);
  }

  /** Record a clean success; may relax pacing after enough in a row. */
  onSuccess(): void {
    this.cleanStreak += 1;
    if (this.cleanStreak < this.cfg.relaxAfter) return;
    this.cleanStreak = 0;

    if (this.concurrency < this.cfg.maxConcurrency) {
      this.concurrency += 1;
    } else if (this.delayMs > 0) {
      this.delayMs = Math.floor(this.delayMs / 2);
      if (this.delayMs < this.cfg.baseDelayMs / 2) this.delayMs = 0;
    }
  }
}
