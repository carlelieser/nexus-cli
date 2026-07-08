import type {
  CollectionMember,
  DownloadTarget,
  GameDomain,
  ModDetails,
  ModSearch,
} from '@core/types.js';

/** A JSON HTTP request the browser session can execute with the session. */
export interface JsonRequest {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * All Nexus site knowledge — URL shapes, page structure, selectors, the
 * GraphQL API — lives behind this interface so the app never learns site
 * specifics.
 */
export interface NexusSite {
  /** Canonical URL of a mod's page. */
  modUrl(game: GameDomain, modId: number): string;

  /** URL of a mod's "files" tab. */
  modFilesUrl(game: GameDomain, modId: number): string;

  /** URL of a collection page (its mods tab). */
  collectionUrl(game: GameDomain, ref: string): string;

  /** Build the GraphQL request that lists a collection's pinned files. */
  collectionMembersQuery(game: GameDomain, ref: string): JsonRequest;

  /** Parse the GraphQL response into collection members. */
  parseCollectionMembers(json: unknown): CollectionMember[];

  /** Build the GraphQL request that searches mods by name. */
  modSearchQuery(term: string, opts: { game?: GameDomain; limit: number }): JsonRequest;

  /** Parse the GraphQL search response. */
  parseModSearch(json: unknown): ModSearch;

  /** Build the GraphQL request that resolves a game domain to its numeric id. */
  gameIdQuery(game: GameDomain): JsonRequest;

  /** Parse the game-id response. Throws when the domain is unknown. */
  parseGameId(json: unknown): number;

  /** Build the GraphQL request that fetches one mod's details. */
  modDetailsQuery(gameId: number, modId: number): JsonRequest;

  /** Parse the mod-details response. Null when the mod does not exist. */
  parseModDetails(json: unknown): ModDetails | null;

  /** Build the manual-download URL for a specific file of a mod. */
  fileDownloadUrl(game: GameDomain, modId: number, fileId: number): string;

  /**
   * Build the mod-manager handoff URL for a file: the download URL with
   * `nmm=1`, which makes Nexus fire the `nxm://` deep link the user's installed
   * mod manager catches. Opened in the user's real browser, never fetched.
   */
  nmmDownloadUrl(game: GameDomain, modId: number, fileId: number): string;

  /**
   * Parse a mod files page's HTML into downloadable targets.
   * Implementations should tag each target's category so the app can keep
   * only `main` files.
   */
  parseDownloadTargets(html: string): DownloadTarget[];

  /**
   * Whether a landed URL means the session was bounced to Nexus's sign-in host
   * (i.e. the cookies no longer authenticate us). A URL fact, not a guess from
   * page markup.
   */
  isAuthRedirect(landedUrl: string): boolean;
}
