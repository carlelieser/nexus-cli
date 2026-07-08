import { ScrapeError } from '@core/errors.js';
import type {
  CollectionMember,
  DownloadTarget,
  FileCategory,
  GameDomain,
  ModDetails,
  ModRequirement,
  ModSearch,
  ModSearchResult,
} from '@core/types.js';
import type { JsonRequest, NexusSite } from './NexusSite.js';

const BASE = 'https://www.nexusmods.com';
const GRAPHQL_URL = 'https://api-router.nexusmods.com/graphql';
const SIGN_IN_HOST = 'users.nexusmods.com';

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

const MOD_SEARCH_QUERY = `
  query ModsSearch($filter: ModsFilter, $count: Int, $offset: Int) {
    mods(filter: $filter, count: $count, offset: $offset,
         sort: { endorsements: { direction: DESC } }) {
      totalCount
      nodes {
        modId
        name
        summary
        downloads
        endorsements
        game { domainName }
      }
    }
  }`;

const GAME_ID_QUERY = `
  query GameId($domain: String!) {
    game(domainName: $domain) { id }
  }`;

// The mods filter only accepts a numeric gameId alongside modId (filtering by
// gameDomainName + modId is rejected), hence the separate GameId lookup.
const MOD_DETAILS_QUERY = `
  query ModDetails($filter: ModsFilter) {
    mods(filter: $filter, count: 1) {
      nodes {
        modId
        name
        summary
        version
        author
        uploader { name }
        createdAt
        updatedAt
        downloads
        endorsements
        adultContent
        pictureUrl
        game { domainName }
        gameId
        modRequirements {
          dlcRequirements { gameExpansion { name } notes }
          nexusRequirements(count: 50) {
            nodes { modName notes url modId gameId externalRequirement }
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
  modUrl(game: GameDomain, modId: number): string {
    return `${BASE}/${game}/mods/${modId}`;
  }

  modFilesUrl(game: GameDomain, modId: number): string {
    return `${this.modUrl(game, modId)}?tab=files`;
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

  modSearchQuery(term: string, opts: { game?: GameDomain; limit: number }): JsonRequest {
    return {
      url: GRAPHQL_URL,
      body: {
        operationName: 'ModsSearch',
        query: MOD_SEARCH_QUERY,
        variables: {
          count: opts.limit,
          offset: 0,
          filter: {
            name: { value: term, op: 'WILDCARD' },
            ...(opts.game ? { gameDomainName: { value: opts.game, op: 'EQUALS' } } : {}),
          },
        },
      },
      headers: { 'x-graphql-operationname': 'ModsSearch' },
    };
  }

  parseModSearch(json: unknown): ModSearch {
    const mods = (json as GqlSearchResponse)?.data?.mods;
    if (!Array.isArray(mods?.nodes)) {
      throw new ScrapeError('unexpected search response shape');
    }

    // Zero matches is a valid answer (unlike an empty collection).
    const results: ModSearchResult[] = [];
    for (const node of mods.nodes) {
      const game = node.game?.domainName;
      if (!node.modId || !node.name || !game) continue;
      results.push({
        game,
        modId: node.modId,
        name: node.name,
        ...(node.summary ? { summary: node.summary } : {}),
        ...(typeof node.downloads === 'number' ? { downloads: node.downloads } : {}),
        ...(typeof node.endorsements === 'number' ? { endorsements: node.endorsements } : {}),
      });
    }

    return { results, totalCount: mods.totalCount ?? results.length };
  }

  gameIdQuery(game: GameDomain): JsonRequest {
    return {
      url: GRAPHQL_URL,
      body: {
        operationName: 'GameId',
        query: GAME_ID_QUERY,
        variables: { domain: game },
      },
      headers: { 'x-graphql-operationname': 'GameId' },
    };
  }

  parseGameId(json: unknown): number {
    const id = (json as GqlGameIdResponse)?.data?.game?.id;
    if (typeof id !== 'number') {
      throw new ScrapeError('unknown game domain');
    }
    return id;
  }

  modDetailsQuery(gameId: number, modId: number): JsonRequest {
    return {
      url: GRAPHQL_URL,
      body: {
        operationName: 'ModDetails',
        query: MOD_DETAILS_QUERY,
        variables: {
          filter: {
            gameId: { value: String(gameId), op: 'EQUALS' },
            modId: { value: String(modId), op: 'EQUALS' },
          },
        },
      },
      headers: { 'x-graphql-operationname': 'ModDetails' },
    };
  }

  parseModDetails(json: unknown): ModDetails | null {
    const nodes = (json as GqlModDetailsResponse)?.data?.mods?.nodes;
    if (!Array.isArray(nodes)) {
      throw new ScrapeError('unexpected mod details response shape');
    }

    const node = nodes[0];
    const game = node?.game?.domainName;
    if (!node?.modId || !node.name || !game) return null;

    const requirements = requirementsOf(node);
    return {
      game,
      modId: node.modId,
      name: node.name,
      ...(node.summary ? { summary: node.summary } : {}),
      ...(node.version ? { version: node.version } : {}),
      ...(node.author ? { author: node.author } : {}),
      ...(node.uploader?.name ? { uploader: node.uploader.name } : {}),
      ...(node.createdAt ? { createdAt: node.createdAt } : {}),
      ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
      ...(typeof node.downloads === 'number' ? { downloads: node.downloads } : {}),
      ...(typeof node.endorsements === 'number' ? { endorsements: node.endorsements } : {}),
      ...(typeof node.adultContent === 'boolean' ? { adultContent: node.adultContent } : {}),
      ...(node.pictureUrl ? { pictureUrl: node.pictureUrl } : {}),
      ...(requirements.length > 0 ? { requirements } : {}),
    };
  }

  fileDownloadUrl(game: GameDomain, modId: number, fileId: number): string {
    return `${BASE}/${game}/mods/${modId}?tab=files&file_id=${fileId}`;
  }

  nmmDownloadUrl(game: GameDomain, modId: number, fileId: number): string {
    return `${this.fileDownloadUrl(game, modId, fileId)}&nmm=1`;
  }

  parseDownloadTargets(html: string): DownloadTarget[] {
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

  isAuthRedirect(landedUrl: string): boolean {
    // An expired/invalid session is bounced to the sign-in host. Compare the
    // host exactly (a substring match would also flag the main site's own
    // `users.nexusmods.com`-less paths inconsistently).
    try {
      return new URL(landedUrl).host === SIGN_IN_HOST;
    } catch {
      return false;
    }
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

interface GqlSearchResponse {
  data?: {
    mods?: {
      totalCount?: number;
      nodes?: {
        modId?: number;
        name?: string;
        summary?: string;
        downloads?: number;
        endorsements?: number;
        game?: { domainName?: GameDomain };
      }[];
    };
  };
}

interface GqlGameIdResponse {
  data?: { game?: { id?: number } | null };
}

interface GqlModDetailsNode {
  modId?: number;
  name?: string;
  summary?: string;
  version?: string;
  author?: string;
  uploader?: { name?: string } | null;
  createdAt?: string;
  updatedAt?: string;
  downloads?: number;
  endorsements?: number;
  adultContent?: boolean;
  pictureUrl?: string;
  game?: { domainName?: GameDomain };
  gameId?: number;
  modRequirements?: {
    dlcRequirements?: { gameExpansion?: { name?: string } | null; notes?: string | null }[];
    nexusRequirements?: {
      nodes?: {
        modName?: string;
        notes?: string | null;
        url?: string;
        modId?: string;
        gameId?: string;
        externalRequirement?: boolean;
      }[];
    };
  } | null;
}

interface GqlModDetailsResponse {
  data?: { mods?: { nodes?: GqlModDetailsNode[] } };
}

/**
 * Flatten a mod's requirements: DLC first, then Nexus/external mods. A
 * same-game mod requirement gets a `game`/`modId` ref (the API only reports
 * numeric game ids, so cross-game requirements stay name-only).
 */
function requirementsOf(node: GqlModDetailsNode): ModRequirement[] {
  const requirements: ModRequirement[] = [];

  for (const dlc of node.modRequirements?.dlcRequirements ?? []) {
    const name = dlc.gameExpansion?.name;
    if (!name) continue;
    requirements.push({ name, dlc: true, ...(dlc.notes ? { notes: dlc.notes } : {}) });
  }

  for (const req of node.modRequirements?.nexusRequirements?.nodes ?? []) {
    if (!req.modName) continue;
    const modId = Number(req.modId);
    const sameGame =
      !req.externalRequirement &&
      Number(req.gameId) === node.gameId &&
      node.game?.domainName !== undefined;
    requirements.push({
      name: req.modName,
      ...(req.notes ? { notes: req.notes } : {}),
      ...(sameGame && Number.isFinite(modId) && modId > 0
        ? { game: node.game!.domainName!, modId }
        : {}),
      ...(req.url ? { url: req.url } : {}),
    });
  }

  return requirements;
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
