import { describe, expect, it } from 'vitest';

import { getMod } from '@app/getMod.js';
import { MOD_REQUIREMENTS_CAP, NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';
import { ScrapeError } from '@core/errors.js';
import { FakeSession } from '../fakes.js';

const site = new NexusWebAdapter();

/** A session answering the game-id lookup, then the details query. */
function detailsSession(node: unknown): FakeSession {
  const s = new FakeSession();
  s.jsonResponses = [
    { data: { game: { id: 1704 } } },
    { data: { mods: { nodes: node ? [node] : [] } } },
  ];
  return s;
}

describe('getMod', () => {
  it('resolves the game id, then returns the parsed details', async () => {
    const session = detailsSession({
      modId: 12604,
      name: 'SkyUI',
      version: '6.9',
      game: { domainName: 'skyrimspecialedition' },
    });

    const details = await getMod({ site }, session, {
      game: 'skyrimspecialedition',
      modId: 12604,
    });

    expect(details).toMatchObject({
      game: 'skyrimspecialedition',
      modId: 12604,
      name: 'SkyUI',
      version: '6.9',
    });
  });

  it('is null when the mod does not exist in the API or on the page', async () => {
    const details = await getMod({ site }, detailsSession(null), {
      game: 'skyrimspecialedition',
      modId: 999999999,
    });
    expect(details).toBeNull();
  });

  it('throws ScrapeError for an unknown game domain', async () => {
    const session = new FakeSession();
    session.jsonResponses = [{ data: { game: null } }];

    await expect(getMod({ site }, session, { game: 'not-a-game', modId: 1 })).rejects.toThrow(
      ScrapeError,
    );
  });

  it('falls back to scraping the mod page when the API returns no match', async () => {
    const session = detailsSession(null);
    session.setPage(
      site.modUrl('skyrimspecialedition', 53406),
      `<meta property="og:title" content="TrueHUD Curated Bosses">
       <meta property="og:description" content="A boss bar mod.">
       <div class="titlestat">Version</div><div class="stat">1.2</div>`,
    );

    const details = await getMod({ site }, session, {
      game: 'skyrimspecialedition',
      modId: 53406,
    });

    expect(details).toMatchObject({
      game: 'skyrimspecialedition',
      modId: 53406,
      name: 'TrueHUD Curated Bosses',
      summary: 'A boss bar mod.',
      version: '1.2',
    });
  });

  it('is null when the page fallback lands on the sign-in host', async () => {
    const session = detailsSession(null);
    session.redirects.set(
      site.modUrl('skyrimspecialedition', 53406),
      'https://users.nexusmods.com/auth/sign_in',
    );

    const details = await getMod({ site }, session, {
      game: 'skyrimspecialedition',
      modId: 53406,
    });

    expect(details).toBeNull();
  });

  it('re-fetches requirements from the page when the API list hits the cap', async () => {
    // nexusRequirements hard-caps at MOD_REQUIREMENTS_CAP nodes server-side —
    // a list landing exactly on it is the signal the mod has more than we
    // were given, so the full list should come from the page instead.
    const cappedNodes = Array.from({ length: MOD_REQUIREMENTS_CAP }, (_, i) => ({
      modName: `Requirement ${i}`,
      notes: '',
      url: '',
      modId: String(1000 + i),
      gameId: '1704',
      externalRequirement: false,
    }));
    const session = detailsSession({
      modId: 166086,
      name: 'Norden UI',
      game: { domainName: 'skyrimspecialedition' },
      gameId: 1704,
      modRequirements: { nexusRequirements: { nodes: cappedNodes } },
    });
    session.setPage(
      site.modUrl('skyrimspecialedition', 166086),
      `<meta property="og:title" content="Norden UI">
       <mod-download-modal requirements="[{&quot;type&quot;:&quot;mod&quot;,&quot;name&quot;:&quot;Spell Hotbar 2&quot;,&quot;url&quot;:&quot;https:\\/\\/github.com\\/pWn3d1337\\/Skyrim_SpellHotbar2\\/releases&quot;}]"></mod-download-modal>`,
    );

    const details = await getMod({ site }, session, {
      game: 'skyrimspecialedition',
      modId: 166086,
    });

    expect(details?.requirements).toEqual([
      {
        name: 'Spell Hotbar 2',
        url: 'https://github.com/pWn3d1337/Skyrim_SpellHotbar2/releases',
      },
    ]);
  });

  it('keeps the API requirements list when it is below the cap', async () => {
    const session = detailsSession({
      modId: 12604,
      name: 'SkyUI',
      game: { domainName: 'skyrimspecialedition' },
      gameId: 1704,
      modRequirements: {
        nexusRequirements: {
          nodes: [
            {
              modName: 'Skyrim Script Extender (SKSE64)',
              notes: '',
              url: '',
              modId: '30379',
              gameId: '1704',
              externalRequirement: false,
            },
          ],
        },
      },
    });

    const details = await getMod({ site }, session, {
      game: 'skyrimspecialedition',
      modId: 12604,
    });

    expect(details?.requirements).toEqual([
      { name: 'Skyrim Script Extender (SKSE64)', game: 'skyrimspecialedition', modId: 30379 },
    ]);
    expect(session.goneTo).toEqual([]);
  });
});
