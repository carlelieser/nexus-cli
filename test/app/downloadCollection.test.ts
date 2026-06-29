import { describe, expect, it } from 'vitest';

import { downloadCollection } from '../../src/app/downloadCollection.js';
import { NexusWebAdapter } from '../../src/adapters/nexus/NexusWebAdapter.js';
import { FakeDownloader, FakeSession, noSleep } from '../fakes.js';

const site = new NexusWebAdapter();
const GAME = 'skyrimspecialedition';

function member(modId: number, fileId: number, optional: boolean) {
  return {
    fileId,
    optional,
    file: {
      name: `file-${fileId}`,
      mod: { modId, name: `mod-${modId}`, game: { domainName: GAME } },
    },
  };
}

/** A session whose GraphQL response lists the given members. */
function collectionSession(members: ReturnType<typeof member>[]): FakeSession {
  const s = new FakeSession();
  s.jsonResponse = { data: { collectionRevision: { modFiles: members } } };
  return s;
}

const baseParams = {
  game: GAME,
  ref: 'qfftpq',
  outDir: '/out',
  concurrency: 2,
  dryRun: false,
  includeOptional: false,
  retryAttempts: 1,
  retryBaseDelayMs: 1,
  sleep: noSleep,
};

describe('downloadCollection', () => {
  it('downloads each non-optional pinned file by its fileId', async () => {
    const downloader = new FakeDownloader();
    const report = await downloadCollection(
      { site, downloader },
      collectionSession([member(100, 4001, false), member(101, 4002, false)]),
      baseParams,
    );

    expect(report.succeeded).toBe(2);
    expect(downloader.fetched.map((t) => t.fileId).sort((a, b) => a - b)).toEqual([4001, 4002]);
  });

  it('skips optional files by default', async () => {
    const downloader = new FakeDownloader();
    await downloadCollection(
      { site, downloader },
      collectionSession([member(100, 4001, false), member(101, 4002, true)]),
      baseParams,
    );
    expect(downloader.fetched.map((t) => t.fileId)).toEqual([4001]);
  });

  it('includes optional files when asked', async () => {
    const downloader = new FakeDownloader();
    await downloadCollection(
      { site, downloader },
      collectionSession([member(100, 4001, false), member(101, 4002, true)]),
      { ...baseParams, includeOptional: true },
    );
    expect(downloader.fetched.map((t) => t.fileId).sort((a, b) => a - b)).toEqual([4001, 4002]);
  });

  it('is best-effort: one failing file does not abort the batch', async () => {
    const downloader = new FakeDownloader(new Set([4002]));
    const report = await downloadCollection(
      { site, downloader },
      collectionSession([member(100, 4001, false), member(101, 4002, false)]),
      baseParams,
    );
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.results.find((r) => !r.ok)?.throttled).toBe(true);
  });
});
