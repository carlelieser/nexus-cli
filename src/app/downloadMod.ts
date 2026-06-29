import type { BrowserSession } from '@adapters/browser/Browser.js';
import type { Downloader, DownloadProgress } from '@adapters/download/Downloader.js';
import type { NexusSite } from '@adapters/nexus/NexusSite.js';
import { AuthError, ScrapeError } from '@core/errors.js';
import type { GameDomain, ModResult } from '@core/types.js';
import { withRetry } from './retry.js';

export interface DownloadModDeps {
  site: NexusSite;
  downloader: Downloader;
}

export interface DownloadModParams {
  game: GameDomain;
  modId: number;
  outDir: string;
  dryRun: boolean;
  retryAttempts: number;
  retryBaseDelayMs: number;
  /** Injected sleep for retry, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-file byte progress callback. */
  onFileProgress?: (p: DownloadProgress) => void;
  /** Cancels the run (Ctrl+C) between and during file downloads. */
  signal?: AbortSignal;
}

/**
 * Resolve a mod's main file(s) and download them through `session`. Pure
 * orchestration: all site/browser/disk specifics are behind the injected
 * interfaces.
 */
export async function downloadMod(
  deps: DownloadModDeps,
  session: BrowserSession,
  params: DownloadModParams,
): Promise<ModResult> {
  params.signal?.throwIfAborted();
  const url = deps.site.modFilesUrl(params.game, params.modId);
  const landed = await session.goto(url);

  if (deps.site.isAuthRedirect(landed)) {
    throw new AuthError('session expired or not authenticated');
  }

  const html = await session.html();
  const all = deps.site.parseDownloadTargets(html);
  const main = all.filter((t) => t.category === 'main');
  if (main.length === 0) {
    throw new ScrapeError(`mod ${params.modId} has no main files`);
  }

  if (params.dryRun) {
    return {
      modId: params.modId,
      ok: true,
      files: main.map((t) => t.fileName ?? `file-${t.fileId}`),
    };
  }

  const files: string[] = [];
  for (const target of main) {
    params.signal?.throwIfAborted();
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
    files.push(path);
  }

  return { modId: params.modId, ok: true, files };
}
