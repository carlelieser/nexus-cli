import { ScrapeError } from '../../core/errors.js';
import type {
  CollectionMember,
  DownloadTarget,
  FileCategory,
  GameDomain,
} from '../../core/types.js';
import type { JsonRequest, NexusSite } from './NexusSite.js';

const BASE = 'https://www.nexusmods.com';
const GRAPHQL_URL = 'https://api-router.nexusmods.com/graphql';

// Collection members come from Nexus's GraphQL API (the page renders them
// client-side, so they are absent from static HTML). We request only the
// fields we need.
const COLLECTION_QUERY = `
  query CollectionRevisionMods($slug: String!, $viewAdultContent: Boolean = true) {
    collectionRevision(slug: $slug, viewAdultContent: $viewAdultContent) {
      modFiles {
        fileId
        optional
        file {
          name
          sizeInBytes
          mod {
            modId
            name
            game { domainName }
          }
        }
      }
    }
  }`;

/**
 * Scrapes Nexus pages from raw HTML. Deliberately dependency-free (regex over
 * the markup) so it is fast and trivially unit-testable against fixtures.
 *
 * Selectors are isolated here; when the site drifts, only this file and the
 * fixtures change.
 */
export class NexusWebAdapter implements NexusSite {
  modFilesUrl(game: GameDomain, modId: number): string {
    return `${BASE}/${game}/mods/${modId}?tab=files`;
  }

  collectionUrl(game: GameDomain, ref: string): string {
    return `${BASE}/games/${game}/collections/${ref}/mods`;
  }

  collectionMembersQuery(_game: GameDomain, ref: string): JsonRequest {
    return {
      url: GRAPHQL_URL,
      body: {
        operationName: 'CollectionRevisionMods',
        query: COLLECTION_QUERY,
        variables: { slug: ref, viewAdultContent: true },
      },
      headers: { 'x-graphql-operationname': 'CollectionRevisionMods' },
    };
  }

  parseCollectionMembers(json: unknown): CollectionMember[] {
    const modFiles = (json as GqlResponse)?.data?.collectionRevision?.modFiles;
    if (!Array.isArray(modFiles)) {
      throw new ScrapeError('unexpected collection response shape');
    }

    const members: CollectionMember[] = [];
    for (const entry of modFiles) {
      const mod = entry.file?.mod;
      const modId = mod?.modId;
      const game = mod?.game?.domainName;
      const fileId = entry.fileId;
      if (!modId || !game || !fileId) continue;
      const sizeBytes = Number(entry.file?.sizeInBytes);
      members.push({
        game,
        modId,
        fileId,
        optional: Boolean(entry.optional),
        ...(entry.file?.name ? { name: entry.file.name } : {}),
        ...(Number.isFinite(sizeBytes) && sizeBytes > 0 ? { sizeBytes } : {}),
      });
    }

    if (members.length === 0) {
      throw new ScrapeError('collection has no downloadable files');
    }
    return members;
  }

  fileDownloadUrl(game: GameDomain, modId: number, fileId: number): string {
    return `${BASE}/${game}/mods/${modId}?tab=files&file_id=${fileId}`;
  }

  resolveDownloadLinks(html: string): DownloadTarget[] {
    const base = modBaseUrl(html);
    const targets: DownloadTarget[] = [];

    // Each file is a `<dt id="file-expander-header-<id>" data-name=".."
    // data-version="..">` row inside its category section. The `data-id` is the
    // Nexus file id; the actual download href is constructed from it (the file
    // list's download links are otherwise hydrated client-side and absent from
    // static HTML). We segment by category header, then read these rows.
    for (const segment of segmentByCategory(html)) {
      // Match the whole expander-header tag, then read attributes from it
      // (order-independent — Nexus emits id/class/data-* in varying orders).
      const tagRe = /<dt[^>]*id="file-expander-header-(\d+)"[^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(segment.body)) !== null) {
        const fileId = Number(m[1]);
        if (!Number.isFinite(fileId)) continue;
        const tag = m[0];
        const name = (/data-name="([^"]*)"/i.exec(tag)?.[1] ?? '').trim();
        const version = (/data-version="([^"]*)"/i.exec(tag)?.[1] ?? '').trim();
        const fileName = name ? (version ? `${name} ${version}` : name) : undefined;
        targets.push({
          url: downloadUrl(base, fileId),
          fileId,
          category: segment.category,
          ...(fileName ? { fileName } : {}),
        });
      }
    }

    return targets;
  }

  looksLikeAuthWall(html: string): boolean {
    const lower = html.toLowerCase();
    // A Cloudflare interstitial — detected by its challenge script, which is
    // language-independent (the visible "just a moment" text is localized, so
    // we do NOT rely on it). The normal logged-in page does carry a
    // `.../auth` sign-out form, so that string must NOT be treated as a wall.
    const cloudflareChallenge =
      lower.includes('cdn-cgi/challenge-platform') ||
      lower.includes('cf-challenge') ||
      lower.includes('cf_chl_opt');
    const explicitSignInPrompt =
      lower.includes('please log in') || lower.includes('sign in to your account');
    return cloudflareChallenge || explicitSignInPrompt;
  }
}

interface GqlResponse {
  data?: {
    collectionRevision?: {
      modFiles?: {
        fileId?: number;
        optional?: boolean;
        file?: {
          name?: string;
          sizeInBytes?: string;
          mod?: {
            modId?: number;
            name?: string;
            game?: { domainName?: GameDomain };
          };
        };
      }[];
    };
  };
}

interface Segment {
  category: FileCategory;
  body: string;
}

/**
 * Split the files page into per-category segments. The live Nexus page groups
 * files into containers identified by `id="file-container-<cat>-files"` (e.g.
 * `main-files`, `optional-files`, `old-files`, `miscellaneous-files`). As a
 * fallback (and for fixtures), legacy `<h3>Main files</h3>`-style headers are
 * also recognised. Content before the first marker is treated as `unknown`.
 */
function segmentByCategory(html: string): Segment[] {
  const markerRe =
    // 1) Live container ids:   id="file-container-main-files"
    // 2) Legacy text headers:  <h3>Main files</h3> / "Old versions"
    /id="file-container-(main|optional|old|miscellaneous)-files"|<(?:h[1-6]|div|dt)[^>]*>\s*((?:main|optional|old|miscellaneous)[^<]*?files?|old versions?)\s*<\/(?:h[1-6]|div|dt)>/gi;

  const marks: { index: number; category: FileCategory }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(html)) !== null) {
    const category = m[1] ? categoryOf(m[1]) : categoryOf(m[2] ?? '');
    marks.push({ index: m.index, category });
  }

  if (marks.length === 0) {
    return [{ category: 'unknown', body: html }];
  }

  const segments: Segment[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i]!.index;
    const end = i + 1 < marks.length ? marks[i + 1]!.index : html.length;
    segments.push({ category: marks[i]!.category, body: html.slice(start, end) });
  }
  return segments;
}

function categoryOf(label: string): FileCategory {
  const h = label.toLowerCase();
  if (h.startsWith('main')) return 'main';
  if (h.startsWith('optional')) return 'optional';
  if (h.startsWith('old')) return 'old';
  if (h.startsWith('misc')) return 'miscellaneous';
  return 'unknown';
}

/** Extract the `https://.../<game>/mods/<id>` base from the page's og:url. */
function modBaseUrl(html: string): string {
  const og = /property="og:url"\s+content="([^"]+)"/i.exec(html);
  if (og?.[1]) return og[1].replace(/[?#].*$/, '');
  const path = /\/[a-z0-9]+\/mods\/\d+/i.exec(html);
  return path ? `${BASE}${path[0]}` : BASE;
}

/**
 * Build the "Manual download" URL for a file id (no `nmm=1` — that one hands
 * off to a mod manager). This page presents the free slow-download button.
 */
function downloadUrl(base: string, fileId: number): string {
  return `${base}?tab=files&file_id=${fileId}`;
}
