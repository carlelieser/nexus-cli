import type { BrowserSession } from '@adapters/browser/Browser.js';
import { MOD_REQUIREMENTS_CAP } from '@adapters/nexus/NexusWebAdapter.js';
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
 *
 * The `ModDetails` query returns no match for some mods that demonstrably
 * exist (seen on older, lower-numbered mod ids — an apparent gap in Nexus's
 * own filter index, not a bad request: the same modId/gameId values resolve
 * fine via search). When that happens, fall back to scraping the mod's own
 * page. Null only when neither the API nor the page find the mod.
 *
 * Separately, `nexusRequirements` hard-caps at `MOD_REQUIREMENTS_CAP` nodes
 * server-side no matter what count is requested. A `requirements` list that
 * lands exactly on the cap is a mod likely to have more than we were given —
 * re-fetch the page and use its (uncapped) requirements list instead.
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
  const details = deps.site.parseModDetails(await session.postJson(req.url, req.body, req.headers));

  if (!details) {
    const landed = await session.goto(deps.site.modUrl(params.game, params.modId));
    if (deps.site.isAuthRedirect(landed)) return null;
    const html = await session.html();
    return deps.site.parseModDetailsPage(html, params.game, params.modId);
  }

  if (details.requirements?.length === MOD_REQUIREMENTS_CAP) {
    const landed = await session.goto(deps.site.modUrl(params.game, params.modId));
    if (!deps.site.isAuthRedirect(landed)) {
      const html = await session.html();
      const fromPage = deps.site.parseModDetailsPage(html, params.game, params.modId);
      if (fromPage?.requirements) return { ...details, requirements: fromPage.requirements };
    }
  }

  return details;
}
