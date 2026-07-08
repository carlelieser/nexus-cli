import { describe, expect, it } from 'vitest';

import { CamoufoxBrowser } from '@adapters/browser/CamoufoxBrowser.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';
import { FileSessionStore } from '@adapters/session/FileSessionStore.js';
import { restoreSession } from '@app/restoreSession.js';

/**
 * Opt-in live smoke test. Hits Nexus for real to catch site drift the fixtures
 * would miss. Runs only when NEXUS_LIVE_TESTS=1 and a saved session exists;
 * otherwise it self-skips, so it is safe in the default suite and CI.
 */
const live = process.env.NEXUS_LIVE_TESTS === '1';

describe('live smoke', () => {
  it.skipIf(!live)(
    'resolves main files for a known mod',
    async () => {
      const deps = {
        browser: new CamoufoxBrowser(),
        store: new FileSessionStore(),
        site: new NexusWebAdapter(),
      };
      const session = await restoreSession(deps, false);
      try {
        // SkyUI (skyrimspecialedition mod 12604) — a stable, long-lived mod.
        const landed = await session.goto(deps.site.modFilesUrl('skyrimspecialedition', 12604));
        expect(deps.site.isAuthRedirect(landed)).toBe(false);
        const html = await session.html();
        const main = deps.site.parseDownloadTargets(html).filter((t) => t.category === 'main');
        expect(main.length).toBeGreaterThan(0);
      } finally {
        await session.close();
      }
    },
    120_000,
  );

  it.skipIf(!live)(
    'searches mods via the GraphQL API',
    async () => {
      const deps = {
        browser: new CamoufoxBrowser(),
        store: new FileSessionStore(),
        site: new NexusWebAdapter(),
      };
      const session = await restoreSession(deps, false);
      try {
        // SkyUI again — catches GraphQL schema drift in the search operation.
        const req = deps.site.modSearchQuery('SkyUI', {
          game: 'skyrimspecialedition',
          limit: 5,
        });
        const json = await session.postJson(req.url, req.body, req.headers);
        const search = deps.site.parseModSearch(json);
        expect(search.results.some((r) => r.modId === 12604)).toBe(true);
      } finally {
        await session.close();
      }
    },
    120_000,
  );

  it.skipIf(!live)(
    'fetches mod details via the GraphQL API',
    async () => {
      const deps = {
        browser: new CamoufoxBrowser(),
        store: new FileSessionStore(),
        site: new NexusWebAdapter(),
      };
      const session = await restoreSession(deps, false);
      try {
        const gameReq = deps.site.gameIdQuery('skyrimspecialedition');
        const gameId = deps.site.parseGameId(
          await session.postJson(gameReq.url, gameReq.body, gameReq.headers),
        );
        const req = deps.site.modDetailsQuery(gameId, 12604);
        const details = deps.site.parseModDetails(
          await session.postJson(req.url, req.body, req.headers),
        );
        expect(details?.name).toBe('SkyUI');
      } finally {
        await session.close();
      }
    },
    120_000,
  );

  it.skipIf(!live)(
    "pages a mod's requirements and dependents via the GraphQL API",
    async () => {
      const deps = {
        browser: new CamoufoxBrowser(),
        store: new FileSessionStore(),
        site: new NexusWebAdapter(),
      };
      const session = await restoreSession(deps, false);
      try {
        const gameReq = deps.site.gameIdQuery('skyrimspecialedition');
        const gameId = deps.site.parseGameId(
          await session.postJson(gameReq.url, gameReq.body, gameReq.headers),
        );

        const reqQuery = deps.site.modRequirementsQuery(gameId, 12604, { count: 5, offset: 0 });
        const requirements = deps.site.parseModRequirementsPage(
          await session.postJson(reqQuery.url, reqQuery.body, reqQuery.headers),
          gameId,
          'skyrimspecialedition',
        );
        expect(requirements.totalCount).toBeGreaterThan(0);

        const depQuery = deps.site.modDependentsQuery(gameId, 12604, { count: 5, offset: 0 });
        const dependents = deps.site.parseModDependentsPage(
          await session.postJson(depQuery.url, depQuery.body, depQuery.headers),
          gameId,
          'skyrimspecialedition',
        );
        // SkyUI (12604) is a hard dependency for thousands of mods.
        expect(dependents.totalCount).toBeGreaterThan(1000);
      } finally {
        await session.close();
      }
    },
    120_000,
  );
});
