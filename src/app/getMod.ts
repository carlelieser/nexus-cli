import type { BrowserSession } from '@adapters/browser/Browser.js';
import type { NexusSite } from '@adapters/nexus/NexusSite.js';
import type { GameDomain, ModDetails } from '@core/types.js';

export interface GetModDeps {
  site: NexusSite;
}

export interface GetModParams {
  game: GameDomain;
  modId: number;
}

/**
 * Fetch one mod's details via the Nexus GraphQL API. Two round-trips: the mods
 * filter only accepts a numeric game id, so the domain is resolved first.
 * Null when the mod does not exist.
 */
export async function getMod(
  deps: GetModDeps,
  session: BrowserSession,
  params: GetModParams,
): Promise<ModDetails | null> {
  const gameReq = deps.site.gameIdQuery(params.game);
  const gameId = deps.site.parseGameId(
    await session.postJson(gameReq.url, gameReq.body, gameReq.headers),
  );

  const req = deps.site.modDetailsQuery(gameId, params.modId);
  return deps.site.parseModDetails(await session.postJson(req.url, req.body, req.headers));
}
