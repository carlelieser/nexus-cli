import { describe, expect, it } from 'vitest';

import { CamoufoxBrowser } from '../../src/adapters/browser/CamoufoxBrowser.js';
import { NexusWebAdapter } from '../../src/adapters/nexus/NexusWebAdapter.js';
import { FileSessionStore } from '../../src/adapters/session/FileSessionStore.js';
import { restoreSession } from '../../src/app/restoreSession.js';

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
        await session.goto(deps.site.modFilesUrl('skyrimspecialedition', 12604));
        const html = await session.html();
        expect(deps.site.looksLikeAuthWall(html)).toBe(false);
        const main = deps.site.resolveDownloadLinks(html).filter((t) => t.category === 'main');
        expect(main.length).toBeGreaterThan(0);
      } finally {
        await session.close();
      }
    },
    120_000,
  );
});
