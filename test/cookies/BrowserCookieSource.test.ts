import type { ExportedCookie } from '@mherod/get-cookie';
import { describe, expect, it } from 'vitest';

import { AuthError } from '@core/errors.js';
import { BrowserCookieSource, toCookie } from '@adapters/cookies/BrowserCookieSource.js';

describe('BrowserCookieSource construction', () => {
  it('accepts supported browsers', () => {
    for (const name of ['chrome', 'brave', 'edge', 'firefox', 'safari', 'CHROME']) {
      expect(() => new BrowserCookieSource(name)).not.toThrow();
    }
  });

  it('rejects an unsupported browser', () => {
    expect(() => new BrowserCookieSource('lynx')).toThrow(AuthError);
  });

  it('sets a human display name', () => {
    expect(new BrowserCookieSource('brave').browser).toBe('Brave');
    expect(new BrowserCookieSource('edge').browser).toBe('Edge');
  });
});

describe('toCookie', () => {
  const base: ExportedCookie = {
    name: 'nexusmods_session',
    value: 'abc123',
    domain: '.nexusmods.com',
  };

  it('maps name, value, domain and defaults path', () => {
    expect(toCookie(base)).toMatchObject({
      name: 'nexusmods_session',
      value: 'abc123',
      domain: '.nexusmods.com',
      path: '/',
    });
  });

  it('converts a Date expiry to unix seconds', () => {
    const c = toCookie({ ...base, expiry: new Date('2027-01-01T00:00:00Z') });
    expect(c.expires).toBe(Math.floor(Date.parse('2027-01-01T00:00:00Z') / 1000));
  });

  it('treats a large numeric expiry as milliseconds', () => {
    const c = toCookie({ ...base, expiry: 1_800_000_000_000 });
    expect(c.expires).toBe(1_800_000_000);
  });

  it('keeps a small numeric expiry as seconds', () => {
    const c = toCookie({ ...base, expiry: 1_800_000_000 });
    expect(c.expires).toBe(1_800_000_000);
  });

  it('omits expiry for "Infinity" / undefined', () => {
    expect(toCookie({ ...base, expiry: 'Infinity' }).expires).toBeUndefined();
    expect(toCookie(base).expires).toBeUndefined();
  });

  it('carries secure / httpOnly / path from meta when present', () => {
    const c = toCookie({ ...base, meta: { secure: true, httpOnly: false, path: '/foo' } });
    expect(c).toMatchObject({ secure: true, httpOnly: false, path: '/foo' });
  });
});
