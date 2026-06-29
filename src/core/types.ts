/**
 * Pure domain types. No I/O, no dependency on adapters.
 */

/** A Nexus game domain slug, e.g. `skyrimspecialedition`. */
export type GameDomain = string;

/** A browser cookie, in the shape Playwright round-trips. */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * A persisted, reusable authenticated session — cookies imported from the
 * user's real browser (which has already cleared Cloudflare and logged in).
 */
export interface Session {
  /** Nexus username, when resolvable from the imported data. */
  username: string;
  /** Imported Nexus cookies, replayed into a headless context for downloads. */
  cookies: Cookie[];
  /** ISO-8601 timestamp of when the cookies were imported. */
  capturedAt: string;
}

/** A single downloadable file resolved from a mod's files page. */
export interface DownloadTarget {
  /** The (possibly relative) URL that initiates the download. */
  url: string;
  /** Nexus file id, used for fallback naming. */
  fileId: number;
  /** Human-readable file name from the page, if known. */
  fileName?: string;
  /** Nexus file category. Only `main` files are downloaded by default. */
  category: FileCategory;
}

export type FileCategory = 'main' | 'optional' | 'miscellaneous' | 'old' | 'unknown';

/** A mod, identified within a game domain. */
export interface Mod {
  game: GameDomain;
  modId: number;
  /** Mod display name, when resolved. */
  name?: string;
}

/**
 * A member of a collection — one specific file the collection curates. A
 * collection pins exact files (by `fileId`), not just mods, and flags some as
 * optional.
 */
export interface CollectionMember {
  game: GameDomain;
  modId: number;
  /** The specific file the collection pins for this mod. */
  fileId: number;
  /** Whether the collection marks this file optional. */
  optional: boolean;
  /** File / mod display name, when available. */
  name?: string;
  /** File size in bytes, when the API reports it (for a global ETA). */
  sizeBytes?: number;
}

/** A collection, identified by slug or numeric id within a game domain. */
export interface Collection {
  game: GameDomain;
  /** The slug or id as supplied by the user. */
  ref: string;
  members: CollectionMember[];
}

/** Outcome of attempting to download one mod. */
export interface ModResult {
  modId: number;
  ok: boolean;
  /** Paths of files written for this mod (on success). */
  files: string[];
  /** Error message (on failure). */
  error?: string;
  /** Set when the failure was attributed to site throttling. */
  throttled?: boolean;
}

/** Aggregate result of a download run (single mod or collection). */
export interface DownloadReport {
  results: ModResult[];
  succeeded: number;
  failed: number;
}

export function summarize(results: ModResult[]): DownloadReport {
  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
