import type { BrowserSession } from '@adapters/browser/Browser.js';
import type { Downloader, DownloadProgress } from '@adapters/download/Downloader.js';
import type { NexusSite } from '@adapters/nexus/NexusSite.js';
import { isCancel } from '@core/errors.js';
import {
  type CollectionMember,
  type DownloadReport,
  type DownloadTarget,
  type GameDomain,
  type ModResult,
  summarize,
} from '@core/types.js';
import { BackoffPolicy, DEFAULT_BACKOFF } from './backoff.js';
import { isThrottle, withRetry } from './retry.js';

export interface DownloadCollectionDeps {
  site: NexusSite;
  downloader: Downloader;
}

export interface DownloadCollectionParams {
  game: GameDomain;
  ref: string;
  outDir: string;
  concurrency: number;
  dryRun: boolean;
  includeOptional: boolean;
  nmm?: boolean;
  retryAttempts: number;
  retryBaseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onResolved?: (members: CollectionMember[]) => void;
  onStart?: (member: CollectionMember, index: number, total: number) => void;
  onFileProgress?: (p: DownloadProgress) => void;
  onProgress?: (r: ModResult) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a collection's pinned files via the Nexus GraphQL API and download each
 * one directly by its `fileId` (the collection curates exact files, so we do
 * not re-scrape per-mod files pages). Best-effort: one failure never aborts the
 * batch. Pacing adapts to throttling via {@link BackoffPolicy}, which lives in
 * the app layer (browser-agnostic).
 */
export async function downloadCollection(
  deps: DownloadCollectionDeps,
  session: BrowserSession,
  params: DownloadCollectionParams,
): Promise<DownloadReport> {
  const sleep = params.sleep ?? defaultSleep;

  params.signal?.throwIfAborted();
  const req = deps.site.collectionMembersQuery(params.game, params.ref);
  const json = await session.postJson(req.url, req.body, req.headers);
  const all = deps.site.parseCollectionMembers(json);
  const members = params.includeOptional ? all : all.filter((m) => !m.optional);
  params.onResolved?.(members);

  const policy = new BackoffPolicy({
    maxConcurrency: params.concurrency,
    ...DEFAULT_BACKOFF,
  });

  const results: ModResult[] = [];
  for (let i = 0; i < members.length; i++) {
    params.signal?.throwIfAborted();

    const member = members[i]!;
    if (policy.currentDelayMs > 0) {
      await sleep(policy.currentDelayMs);
    }

    params.onStart?.(member, i + 1, members.length);
    const result = await runOne(deps, session, params, member);
    results.push(result);

    if (result.ok) policy.onSuccess();
    else if (result.throttled) policy.onThrottle();

    params.onProgress?.(result);
  }

  return summarize(results);
}

async function runOne(
  deps: DownloadCollectionDeps,
  session: BrowserSession,
  params: DownloadCollectionParams,
  member: CollectionMember,
): Promise<ModResult> {
  const name = member.name ?? `mod ${member.modId} file ${member.fileId}`;

  if (params.dryRun) {
    return { modId: member.modId, ok: true, files: [name] };
  }

  if (params.nmm) {
    try {
      await session.handToManager(
        deps.site.nmmDownloadUrl(member.game, member.modId, member.fileId),
      );
      return { modId: member.modId, ok: true, files: [name] };
    } catch (e) {
      if (isCancel(e)) throw e;
      const message = e instanceof Error ? e.message : String(e);
      return {
        modId: member.modId,
        ok: false,
        files: [],
        error: message,
        throttled: isThrottle(e),
      };
    }
  }

  const target: DownloadTarget = {
    url: deps.site.fileDownloadUrl(member.game, member.modId, member.fileId),
    fileId: member.fileId,
    category: member.optional ? 'optional' : 'main',
    ...(member.name ? { fileName: member.name } : {}),
  };

  try {
    const path = await withRetry(
      () =>
        deps.downloader.fetch(target, params.outDir, session, params.onFileProgress, params.signal),
      {
        attempts: params.retryAttempts,
        baseDelayMs: params.retryBaseDelayMs,
        ...(params.sleep ? { sleep: params.sleep } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
      },
    );
    return { modId: member.modId, ok: true, files: [path] };
  } catch (e) {
    if (isCancel(e)) throw e;
    const message = e instanceof Error ? e.message : String(e);
    return {
      modId: member.modId,
      ok: false,
      files: [],
      error: message,
      throttled: isThrottle(e),
    };
  }
}
