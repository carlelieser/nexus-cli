import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileSessionStore } from '@adapters/session/FileSessionStore.js';
import type { Session } from '@core/types.js';

const sample: Session = {
  username: 'tester',
  cookies: [{ name: 'sid', value: 'abc', domain: '.nexusmods.com', path: '/' }],
  capturedAt: new Date().toISOString(),
};

function tempStore(): FileSessionStore {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-session-'));
  return new FileSessionStore(join(dir, 'session.json'));
}

describe('FileSessionStore', () => {
  it('returns null when nothing is saved', async () => {
    expect(await tempStore().load()).toBeNull();
  });

  it('round-trips a session', async () => {
    const store = tempStore();
    await store.save(sample);
    expect(await store.load()).toEqual(sample);
  });

  it.skipIf(process.platform === 'win32')('writes with 600 permissions', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'nexus-perm-')), 'session.json');
    const store = new FileSessionStore(path);
    await store.save(sample);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clear() is idempotent', async () => {
    const store = tempStore();
    await store.save(sample);
    await store.clear();
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
