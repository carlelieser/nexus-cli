import type { DownloadTarget } from '@core/types.js';
import type { BrowserSession } from '../browser/Browser.js';

/** Progress of an in-flight file download. */
export interface DownloadProgress {
  receivedBytes: number;
  /** Total size from Content-Length, or 0 when unknown. */
  totalBytes: number;
}

/** Fetches a single resolved file to disk. */
export interface Downloader {
  /**
   * Resolve `target`'s signed CDN URL via the browser session, then stream it
   * to disk. `onProgress` is invoked as bytes arrive. Returns the final path.
   * When `signal` aborts, the stream is torn down and the partial file removed.
   */
  fetch(
    target: DownloadTarget,
    outDir: string,
    session: BrowserSession,
    onProgress?: (p: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}
