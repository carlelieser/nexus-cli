import type { BrowserSession } from '@adapters/browser/Browser.js';
import type { Downloader, DownloadProgress } from '@adapters/download/Downloader.js';
import type { NexusSite } from '@adapters/nexus/NexusSite.js';
import { AuthError, ScrapeError } from '@core/errors.js';
import type { GameDomain, ModResult } from '@core/types.js';
import { withRetry } from './retry.js';

/** Opens a URL in the user's default OS browser (for the mod-manager handoff). */
export type Opener = (url: string) => Promise<void>;

export interface DownloadModDeps {
  site: NexusSite;
  downloader: Downloader;
  /** Required only for `nmm` runs. */
  opener?: Opener;
}

export interface DownloadModParams {
  game: GameDomain;
  modId: number;
  outDir: string;
  dryRun: boolean;
  /** Defer the download to the user's mod manager instead of fetching. */
  nmm?: boolean;
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

  // `nmm` hands off to the user's mod manager: open each file's download URL
  // with `nmm=1` in their real browser (which has the `nxm://` handler) rather
  // than streaming the file ourselves. Each target.url already carries a query
  // string, so the param appends as `&nmm=1`.
  if (params.nmm) {
    if (!deps.opener) throw new ScrapeError('nmm requires a URL opener');
    const opened: string[] = [];
    for (const target of main) {
      params.signal?.throwIfAborted();
      await deps.opener(`${target.url}&nmm=1`);
      opened.push(target.fileName ?? `file-${target.fileId}`);
    }
    return { modId: params.modId, ok: true, files: opened };
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
