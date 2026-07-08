import { describe, expect, it } from 'vitest';

import { getMod } from '@app/getMod.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';
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

  it('is null when the mod does not exist', async () => {
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
});
