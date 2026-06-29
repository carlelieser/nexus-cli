import type { CollectionMember, DownloadTarget, GameDomain } from '@core/types.js';

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
  /** URL of a mod's "files" tab. */
  modFilesUrl(game: GameDomain, modId: number): string;

  /** URL of a collection page (its mods tab). */
  collectionUrl(game: GameDomain, ref: string): string;

  /** Build the GraphQL request that lists a collection's pinned files. */
  collectionMembersQuery(game: GameDomain, ref: string): JsonRequest;

  /** Parse the GraphQL response into collection members. */
  parseCollectionMembers(json: unknown): CollectionMember[];

  /** Build the manual-download URL for a specific file of a mod. */
  fileDownloadUrl(game: GameDomain, modId: number, fileId: number): string;

  /**
   * Parse a mod files page's HTML into downloadable targets.
   * Implementations should tag each target's category so the app can keep
   * only `main` files.
   */
  resolveDownloadLinks(html: string): DownloadTarget[];

  /**
   * Whether a landed URL means the session was bounced to Nexus's sign-in host
   * (i.e. the cookies no longer authenticate us). A URL fact, not a guess from
   * page markup.
   */
  isAuthRedirect(landedUrl: string): boolean;
}
