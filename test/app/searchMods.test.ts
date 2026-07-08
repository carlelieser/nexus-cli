import { describe, expect, it } from 'vitest';

import { searchMods } from '@app/searchMods.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';
import { FakeSession } from '../fakes.js';

const site = new NexusWebAdapter();

/** A session whose GraphQL response lists the given search nodes. */
function searchSession(nodes: unknown[], totalCount = nodes.length): FakeSession {
  const s = new FakeSession();
  s.jsonResponse = { data: { mods: { totalCount, nodes } } };
  return s;
}

describe('searchMods', () => {
  it('returns parsed results with the total count', async () => {
    const session = searchSession(
      [
        {
          modId: 12604,
          name: 'SkyUI',
          endorsements: 500,
          game: { domainName: 'skyrimspecialedition' },
        },
        { modId: 3863, name: 'SkyUI', game: { domainName: 'skyrim' } },
      ],
      259,
    );

    const search = await searchMods({ site }, session, { term: 'skyui', limit: 10 });

    expect(search.totalCount).toBe(259);
    expect(search.results.map((r) => r.modId)).toEqual([12604, 3863]);
    expect(search.results[0]?.game).toBe('skyrimspecialedition');
  });

  it('returns an empty result for zero matches', async () => {
    const search = await searchMods({ site }, searchSession([]), {
      term: 'nope',
      game: 'skyrimspecialedition',
      limit: 10,
    });
    expect(search).toEqual({ results: [], totalCount: 0 });
  });
});
