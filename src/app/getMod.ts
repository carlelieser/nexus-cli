import type { BrowserSession } from '@adapters/browser/Browser.js';
import { MOD_REQUIREMENTS_CAP } from '@adapters/nexus/NexusWebAdapter.js';
import type { NexusSite } from '@adapters/nexus/NexusSite.js';
import type { GameDomain, ModDependent, ModDetails, ModRequirement, Page } from '@core/types.js';

export interface GetModDeps {
  site: NexusSite;
}

export interface GetModParams {
  game: GameDomain;
  modId: number;
}

export interface GetModPageParams extends GetModParams {
  count: number;
  offset: number;
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
  const gameId = await resolveGameId(deps, session, params.game);

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

/** Fetch one page of a mod's own requirements. */
export async function getModRequirements(
  deps: GetModDeps,
  session: BrowserSession,
  params: GetModPageParams,
): Promise<Page<ModRequirement>> {
  const gameId = await resolveGameId(deps, session, params.game);
  const req = deps.site.modRequirementsQuery(gameId, params.modId, {
    count: params.count,
    offset: params.offset,
  });
  return deps.site.parseModRequirementsPage(
    await session.postJson(req.url, req.body, req.headers),
    gameId,
    params.game,
  );
}

/** Fetch one page of mods that depend on (require) a mod. */
export async function getModDependents(
  deps: GetModDeps,
  session: BrowserSession,
  params: GetModPageParams,
): Promise<Page<ModDependent>> {
  const gameId = await resolveGameId(deps, session, params.game);
  const req = deps.site.modDependentsQuery(gameId, params.modId, {
    count: params.count,
    offset: params.offset,
  });
  return deps.site.parseModDependentsPage(
    await session.postJson(req.url, req.body, req.headers),
    gameId,
    params.game,
  );
}

/** Resolve a game domain to Nexus's numeric game id (the mods filter requires it). */
async function resolveGameId(
  deps: GetModDeps,
  session: BrowserSession,
  game: GameDomain,
): Promise<number> {
  const gameReq = deps.site.gameIdQuery(game);
  return deps.site.parseGameId(await session.postJson(gameReq.url, gameReq.body, gameReq.headers));
}
