import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { downloadMod } from '@app/downloadMod.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';
import { AuthError, isCancel } from '@core/errors.js';
import { FakeDownloader, FakeSession, noSleep } from '../fakes.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

const site = new NexusWebAdapter();
const baseParams = {
  game: 'skyrimspecialedition',
  modId: 100,
  outDir: '/out',
  dryRun: false,
  retryAttempts: 3,
  retryBaseDelayMs: 1,
  sleep: noSleep,
};

function sessionFor(html: string): FakeSession {
  const url = site.modFilesUrl('skyrimspecialedition', 100);
  return new FakeSession().setPage(url, html);
}

describe('downloadMod', () => {
  it('downloads only main files', async () => {
    const downloader = new FakeDownloader();
    const result = await downloadMod(
      { site, downloader },
      sessionFor(fixture('mod-files.html')),
      baseParams,
    );

    expect(result.ok).toBe(true);
    expect(downloader.fetched.map((t) => t.fileId).sort((a, b) => a - b)).toEqual([4001, 4002]);
    expect(result.files).toHaveLength(2);
  });

  it('does not fetch on a dry run', async () => {
    const downloader = new FakeDownloader();
    const result = await downloadMod({ site, downloader }, sessionFor(fixture('mod-files.html')), {
      ...baseParams,
      dryRun: true,
    });
    expect(downloader.fetched).toHaveLength(0);
    expect(result.files).toEqual(['Awesome Mod 2.1', 'Awesome Mod - Patch 1.0']);
  });

  it('nmm hands off each main file with nmm=1 and does not download', async () => {
    const downloader = new FakeDownloader();
    const session = sessionFor(fixture('mod-files.html'));
    const result = await downloadMod({ site, downloader }, session, { ...baseParams, nmm: true });

    expect(result.ok).toBe(true);
    expect(downloader.fetched).toHaveLength(0);
    expect(session.handedOff).toHaveLength(2);
    expect(session.handedOff.every((u) => u.endsWith('&nmm=1'))).toBe(true);
    expect(
      session.handedOff.map((u) => Number(/file_id=(\d+)/.exec(u)?.[1])).sort((a, b) => a - b),
    ).toEqual([4001, 4002]);
  });

  it('nmm + dry run hands off nothing', async () => {
    const session = sessionFor(fixture('mod-files.html'));
    await downloadMod({ site, downloader: new FakeDownloader() }, session, {
      ...baseParams,
      nmm: true,
      dryRun: true,
    });
    expect(session.handedOff).toEqual([]);
  });

  it('throws AuthError when the session is bounced to the sign-in host', async () => {
    const modUrl = site.modFilesUrl('skyrimspecialedition', 100);
    const session = new FakeSession();
    session.redirects.set(modUrl, 'https://users.nexusmods.com/auth/sign_in');

    await expect(
      downloadMod({ site, downloader: new FakeDownloader() }, session, baseParams),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('retries a failing download before giving up', async () => {
    // Fails for file 4001 on every attempt → withRetry exhausts and throws.
    const downloader = new FakeDownloader(new Set([4001]));
    await expect(
      downloadMod({ site, downloader }, sessionFor(fixture('mod-files.html')), baseParams),
    ).rejects.toThrow();
  });

  it('cancels mid-mod and does not retry the aborted file', async () => {
    const downloader = new FakeDownloader();
    const controller = new AbortController();
    // Abort when the first file starts; withRetry must not retry the abort.
    downloader.onFetch = () => controller.abort();

    await expect(
      downloadMod({ site, downloader }, sessionFor(fixture('mod-files.html')), {
        ...baseParams,
        signal: controller.signal,
      }),
    ).rejects.toSatisfy(isCancel);
    expect(downloader.fetched).toEqual([]);
  });
});
