import { describe, expect, it } from 'vitest';

import { downloadCollection } from '@app/downloadCollection.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';
import { isCancel } from '@core/errors.js';
import { FakeDownloader, FakeOpener, FakeSession, noSleep } from '../fakes.js';

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

  it('nmm opens each pinned file and does not download', async () => {
    const downloader = new FakeDownloader();
    const opener = new FakeOpener();
    const report = await downloadCollection(
      { site, downloader, opener: opener.open },
      collectionSession([member(100, 4001, false), member(101, 4002, false)]),
      { ...baseParams, nmm: true },
    );

    expect(report.succeeded).toBe(2);
    expect(downloader.fetched).toEqual([]);
    expect(opener.opened.sort()).toEqual([
      site.nmmDownloadUrl(GAME, 100, 4001),
      site.nmmDownloadUrl(GAME, 101, 4002),
    ]);
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

  it('throws a cancellation without downloading when already aborted', async () => {
    const downloader = new FakeDownloader();
    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadCollection(
        { site, downloader },
        collectionSession([member(100, 4001, false), member(101, 4002, false)]),
        { ...baseParams, signal: controller.signal },
      ),
    ).rejects.toSatisfy(isCancel);
    expect(downloader.fetched).toEqual([]);
  });

  it('stops starting new members once aborted mid-batch', async () => {
    const downloader = new FakeDownloader();
    const controller = new AbortController();
    // Abort as soon as the first file begins; the second must never start.
    downloader.onFetch = () => controller.abort();

    await expect(
      downloadCollection(
        { site, downloader },
        collectionSession([member(100, 4001, false), member(101, 4002, false)]),
        { ...baseParams, signal: controller.signal },
      ),
    ).rejects.toSatisfy(isCancel);
    // The first file's fetch was aborted (throwIfAborted after onFetch), so
    // nothing was recorded, and the second member never began.
    expect(downloader.fetched).toEqual([]);
  });
});
