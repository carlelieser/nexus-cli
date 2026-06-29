import { describe, expect, it } from 'vitest';

import { importSession } from '../../src/app/importSession.js';
import { AuthError } from '../../src/core/errors.js';
import type { Cookie } from '../../src/core/types.js';
import { FakeBrowser, FakeCookieSource, FakeSession, FakeStore } from '../fakes.js';

const cookies: Cookie[] = [
  { name: 'nexusmods_session', value: 'abc', domain: '.nexusmods.com', path: '/' },
];

describe('importSession', () => {
  it('imports, validates, and persists cookies', async () => {
    const browser = new FakeBrowser();
    const store = new FakeStore();
    const session = await importSession(
      { source: new FakeCookieSource(cookies), browser, store },
      { domainSuffix: 'nexusmods.com', validate: true },
    );

    expect(session.cookies).toEqual(cookies);
    expect(session.username).toBe('tester');
    expect(store.saved?.cookies).toHaveLength(1);
    // Validation should have seeded the cookies into the browser context.
    expect(browser.session.seededCookies).toEqual(cookies);
  });

  it('skips browser validation when validate=false', async () => {
    const browser = new FakeBrowser();
    const store = new FakeStore();
    const session = await importSession(
      { source: new FakeCookieSource(cookies), browser, store },
      { domainSuffix: 'nexusmods.com', validate: false },
    );

    expect(session.username).toBe('nexus-user');
    expect(browser.lastLaunch).toBeUndefined();
  });

  it('throws AuthError when no cookies are found', async () => {
    await expect(
      importSession(
        { source: new FakeCookieSource([]), browser: new FakeBrowser(), store: new FakeStore() },
        { domainSuffix: 'nexusmods.com', validate: true },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError when cookies do not authenticate', async () => {
    const fake = new FakeSession();
    fake.loggedIn = false;
    const browser = new FakeBrowser(fake);
    await expect(
      importSession(
        { source: new FakeCookieSource(cookies), browser, store: new FakeStore() },
        { domainSuffix: 'nexusmods.com', validate: true },
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
