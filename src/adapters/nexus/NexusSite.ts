import type {
  CollectionMember,
  DownloadTarget,
  GameDomain,
  ModDependent,
  ModDetails,
  ModRequirement,
  ModSearch,
  Page,
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

  /**
   * Parse a mod's details straight from its page HTML — the fallback for mods
   * the `ModDetails` GraphQL query fails to find (seen for some older mods).
   * Null when the page isn't a mod page (e.g. a 404 or sign-in bounce).
   */
  parseModDetailsPage(html: string, game: GameDomain, modId: number): ModDetails | null;

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

  /** Build the GraphQL request for one page of a mod's own requirements. */
  modRequirementsQuery(
    gameId: number,
    modId: number,
    opts: { count: number; offset: number },
  ): JsonRequest;

  /**
   * Parse a page of a mod's requirements, with the true total across all
   * pages. `gameId`/`game` identify the mod being queried (not returned by
   * this query) so same-game requirement nodes can be given a `game`/`modId`
   * ref.
   */
  parseModRequirementsPage(json: unknown, gameId: number, game: GameDomain): Page<ModRequirement>;

  /** Build the GraphQL request for one page of mods that depend on a mod. */
  modDependentsQuery(
    gameId: number,
    modId: number,
    opts: { count: number; offset: number },
  ): JsonRequest;

  /**
   * Parse a page of a mod's dependents, with the true total across all pages.
   * `gameId`/`game` identify the mod being queried, as with
   * {@link parseModRequirementsPage}.
   */
  parseModDependentsPage(json: unknown, gameId: number, game: GameDomain): Page<ModDependent>;
}
