import { describe, expect, it } from 'vitest';

import { BackoffPolicy } from '@app/backoff.js';

const cfg = {
  maxConcurrency: 3,
  baseDelayMs: 2000,
  maxDelayMs: 16000,
  relaxAfter: 2,
};

describe('BackoffPolicy', () => {
  it('starts fast: no delay, full concurrency', () => {
    const p = new BackoffPolicy(cfg);
    expect(p.currentDelayMs).toBe(0);
    expect(p.currentConcurrency).toBe(3);
  });

  it('introduces and grows delay on throttle, reducing concurrency', () => {
    const p = new BackoffPolicy(cfg);
    p.onThrottle();
    expect(p.currentDelayMs).toBe(2000);
    expect(p.currentConcurrency).toBe(2);
    p.onThrottle();
    expect(p.currentDelayMs).toBe(4000);
    expect(p.currentConcurrency).toBe(1);
  });

  it('caps delay and floors concurrency at 1', () => {
    const p = new BackoffPolicy(cfg);
    for (let i = 0; i < 10; i++) p.onThrottle();
    expect(p.currentDelayMs).toBe(16000);
    expect(p.currentConcurrency).toBe(1);
  });

  it('relaxes after a streak of clean successes', () => {
    const p = new BackoffPolicy(cfg);
    p.onThrottle(); // delay 2000, concurrency 2
    p.onThrottle(); // delay 4000, concurrency 1

    // First relax step restores concurrency.
    p.onSuccess();
    p.onSuccess();
    expect(p.currentConcurrency).toBe(2);

    // A throttle resets the clean streak, so it takes a fresh run to relax.
    p.onSuccess();
    expect(p.currentConcurrency).toBe(2);
  });
});
