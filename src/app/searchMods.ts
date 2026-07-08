import type { BrowserSession } from '@adapters/browser/Browser.js';
import type { NexusSite } from '@adapters/nexus/NexusSite.js';
import type { GameDomain, ModSearch } from '@core/types.js';

export interface SearchModsDeps {
  site: NexusSite;
}

export interface SearchModsParams {
  term: string;
  game?: GameDomain;
  limit: number;
}

/** Search mods by name via the Nexus GraphQL API, most-endorsed first. */
export async function searchMods(
  deps: SearchModsDeps,
  session: BrowserSession,
  params: SearchModsParams,
): Promise<ModSearch> {
  const req = deps.site.modSearchQuery(params.term, {
    ...(params.game ? { game: params.game } : {}),
    limit: params.limit,
  });
  const json = await session.postJson(req.url, req.body, req.headers);
  return deps.site.parseModSearch(json);
}
