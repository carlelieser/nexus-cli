import { access, mkdir, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { DownloadError, NetworkError } from '../../core/errors.js';
import type { DownloadTarget } from '../../core/types.js';
import type { BrowserSession } from '../browser/Browser.js';
import type { Downloader, DownloadProgress } from './Downloader.js';

/**
 * Resolves a file's signed CDN URL through the browser session, then streams it
 * to disk **from Node** (the in-page fetch is blocked by CORS on the CDN host;
 * Node has no CORS restriction). Writes to a `.part` file and renames on
 * success; skips files that already exist.
 */
export class BrowserDownloader implements Downloader {
  async fetch(
    target: DownloadTarget,
    outDir: string,
    session: BrowserSession,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<string> {
    await mkdir(outDir, { recursive: true });

    const resolved = await session.resolveDownloadUrl(target.url);

    // The signed CDN URL carries the real filename in its path.
    const name = filenameFrom(resolved.cdnUrl) ?? fallbackName(target);
    const finalPath = join(outDir, name);
    if (await exists(finalPath)) return finalPath; // already complete — skip.

    const partPath = `${finalPath}.part`;
    let res: Response;
    try {
      res = await fetch(resolved.cdnUrl, {
        headers: {
          cookie: resolved.cookieHeader,
          'user-agent': resolved.userAgent,
        },
      });
    } catch (e) {
      throw new NetworkError(`failed to fetch file ${target.fileId}`, { cause: e });
    }
    if (!res.ok || !res.body) {
      throw new DownloadError(`download for file ${target.fileId} returned HTTP ${res.status}`);
    }

    const totalBytes = Number(res.headers.get('content-length') ?? 0);
    let receivedBytes = 0;
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
      onProgress?.({ receivedBytes, totalBytes });
    });

    try {
      await pipeline(source, createWriteStream(partPath));
    } catch (e) {
      throw new DownloadError(`failed writing file ${target.fileId}`, { cause: e });
    }

    await rename(partPath, finalPath);
    return finalPath;
  }
}

/** Derive the filename from a signed CDN URL's path (decoded). */
function filenameFrom(cdnUrl: string): string | null {
  try {
    const path = new URL(cdnUrl).pathname;
    const base = decodeURIComponent(basename(path));
    return base.length > 0 ? sanitize(base) : null;
  } catch {
    return null;
  }
}

function fallbackName(target: DownloadTarget): string {
  if (target.fileName) {
    const base = sanitize(target.fileName);
    return /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}-${target.fileId}`;
  }
  return `file-${target.fileId}`;
}

function sanitize(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
