import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ScrapeError } from '@core/errors.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

const site = new NexusWebAdapter();

describe('NexusWebAdapter URLs', () => {
  it('builds a mod page url', () => {
    expect(site.modUrl('skyrimspecialedition', 100)).toBe(
      'https://www.nexusmods.com/skyrimspecialedition/mods/100',
    );
  });

  it('builds a mod files url', () => {
    expect(site.modFilesUrl('skyrimspecialedition', 100)).toBe(
      'https://www.nexusmods.com/skyrimspecialedition/mods/100?tab=files',
    );
  });

  it('builds a collection url', () => {
    expect(site.collectionUrl('skyrimspecialedition', 'abc123')).toBe(
      'https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123/mods',
    );
  });

  it('builds an nmm handoff url', () => {
    expect(site.nmmDownloadUrl('skyrimspecialedition', 100, 4001)).toBe(
      'https://www.nexusmods.com/skyrimspecialedition/mods/100?tab=files&file_id=4001&nmm=1',
    );
  });
});

describe('collectionMembersQuery', () => {
  it('builds a GraphQL request for the collection slug', () => {
    const req = site.collectionMembersQuery('skyrimspecialedition', 'qfftpq');
    expect(req.url).toContain('graphql');
    const body = req.body as { variables: { slug: string } };
    expect(body.variables.slug).toBe('qfftpq');
  });
});

describe('parseCollectionMembers', () => {
  const json = {
    data: {
      collectionRevision: {
        modFiles: [
          {
            fileId: 631984,
            optional: false,
            file: {
              name: 'Main A',
              sizeInBytes: '2048',
              mod: { modId: 100, name: 'Mod A', game: { domainName: 'skyrimspecialedition' } },
            },
          },
          {
            fileId: 631983,
            optional: true,
            file: {
              name: 'Opt B',
              mod: { modId: 101, name: 'Mod B', game: { domainName: 'skyrimspecialedition' } },
            },
          },
        ],
      },
    },
  };

  it('maps modFiles to members with fileId, game, and optional flag', () => {
    const members = site.parseCollectionMembers(json);
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({
      game: 'skyrimspecialedition',
      modId: 100,
      fileId: 631984,
      optional: false,
      name: 'Main A',
    });
    expect(members[1]?.optional).toBe(true);
  });

  it('parses file size in bytes when present', () => {
    const members = site.parseCollectionMembers(json);
    expect(members[0]?.sizeBytes).toBe(2048);
    expect(members[1]?.sizeBytes).toBeUndefined();
  });

  it('throws ScrapeError on an unexpected shape', () => {
    expect(() => site.parseCollectionMembers({ data: {} })).toThrow(ScrapeError);
  });

  it('throws ScrapeError when there are no files', () => {
    expect(() =>
      site.parseCollectionMembers({ data: { collectionRevision: { modFiles: [] } } }),
    ).toThrow(ScrapeError);
  });
});

describe('modSearchQuery', () => {
  it('builds a GraphQL request with a wildcard name filter', () => {
    const req = site.modSearchQuery('skyui', { limit: 5 });
    expect(req.url).toContain('graphql');
    expect(req.headers?.['x-graphql-operationname']).toBe('ModsSearch');
    const body = req.body as {
      variables: { count: number; filter: { name: { value: string }; gameDomainName?: unknown } };
    };
    expect(body.variables.count).toBe(5);
    expect(body.variables.filter.name.value).toBe('skyui');
    expect(body.variables.filter.gameDomainName).toBeUndefined();
  });

  it('filters by game domain when given', () => {
    const req = site.modSearchQuery('skyui', { game: 'skyrimspecialedition', limit: 5 });
    const body = req.body as {
      variables: { filter: { gameDomainName?: { value: string } } };
    };
    expect(body.variables.filter.gameDomainName?.value).toBe('skyrimspecialedition');
  });
});

describe('parseModSearch', () => {
  const json = {
    data: {
      mods: {
        totalCount: 193,
        nodes: [
          {
            modId: 12604,
            name: 'SkyUI',
            summary: 'Elegant, PC-friendly interface mod',
            downloads: 1000,
            endorsements: 500,
            game: { domainName: 'skyrimspecialedition' },
          },
          { modId: 3863, name: 'SkyUI', game: { domainName: 'skyrim' } },
        ],
      },
    },
  };

  it('maps nodes to results with the total count', () => {
    const search = site.parseModSearch(json);
    expect(search.totalCount).toBe(193);
    expect(search.results).toHaveLength(2);
    expect(search.results[0]).toMatchObject({
      game: 'skyrimspecialedition',
      modId: 12604,
      name: 'SkyUI',
      summary: 'Elegant, PC-friendly interface mod',
      downloads: 1000,
      endorsements: 500,
    });
    expect(search.results[1]?.summary).toBeUndefined();
  });

  it('skips nodes missing modId, name, or game domain', () => {
    const search = site.parseModSearch({
      data: {
        mods: {
          totalCount: 3,
          nodes: [
            { modId: 1, game: { domainName: 'skyrim' } },
            { modId: 2, name: 'No Game' },
            { modId: 3, name: 'Ok', game: { domainName: 'skyrim' } },
          ],
        },
      },
    });
    expect(search.results.map((r) => r.modId)).toEqual([3]);
  });

  it('returns an empty result for zero matches (no throw)', () => {
    const search = site.parseModSearch({ data: { mods: { totalCount: 0, nodes: [] } } });
    expect(search).toEqual({ results: [], totalCount: 0 });
  });

  it('throws ScrapeError on an unexpected shape', () => {
    expect(() => site.parseModSearch({ data: {} })).toThrow(ScrapeError);
  });
});

describe('gameIdQuery / parseGameId', () => {
  it('builds a GraphQL request for the game domain', () => {
    const req = site.gameIdQuery('skyrimspecialedition');
    expect(req.url).toContain('graphql');
    expect(req.headers?.['x-graphql-operationname']).toBe('GameId');
    const body = req.body as { variables: { domain: string } };
    expect(body.variables.domain).toBe('skyrimspecialedition');
  });

  it('parses the numeric game id', () => {
    expect(site.parseGameId({ data: { game: { id: 1704 } } })).toBe(1704);
  });

  it('throws ScrapeError for an unknown domain', () => {
    expect(() => site.parseGameId({ data: { game: null } })).toThrow(ScrapeError);
  });
});

describe('modDetailsQuery / parseModDetails', () => {
  it('builds a GraphQL request filtering by game id and mod id', () => {
    const req = site.modDetailsQuery(1704, 12604);
    expect(req.url).toContain('graphql');
    expect(req.headers?.['x-graphql-operationname']).toBe('ModDetails');
    const body = req.body as {
      variables: { filter: { gameId: { value: string }; modId: { value: string } } };
    };
    expect(body.variables.filter.gameId.value).toBe('1704');
    expect(body.variables.filter.modId.value).toBe('12604');
  });

  it('maps the node to details, keeping only present fields', () => {
    const details = site.parseModDetails({
      data: {
        mods: {
          nodes: [
            {
              modId: 12604,
              name: 'SkyUI',
              summary: 'Interface mod',
              version: '6.9',
              author: 'SkyUI Team',
              uploader: { name: 'schlangster' },
              createdAt: '2017-10-01T11:55:43Z',
              updatedAt: '2026-05-05T22:41:21Z',
              downloads: 24620161,
              endorsements: 494035,
              adultContent: false,
              pictureUrl: 'https://staticdelivery.nexusmods.com/pic.png',
              game: { domainName: 'skyrimspecialedition' },
            },
          ],
        },
      },
    });
    expect(details).toMatchObject({
      game: 'skyrimspecialedition',
      modId: 12604,
      name: 'SkyUI',
      version: '6.9',
      author: 'SkyUI Team',
      uploader: 'schlangster',
      downloads: 24620161,
      endorsements: 494035,
      adultContent: false,
    });
  });

  it('maps DLC, same-game, cross-game, and external requirements', () => {
    const details = site.parseModDetails({
      data: {
        mods: {
          nodes: [
            {
              modId: 129414,
              name: 'Patch',
              game: { domainName: 'skyrimspecialedition' },
              gameId: 1704,
              modRequirements: {
                dlcRequirements: [{ gameExpansion: { name: 'Dawnguard' }, notes: 'vampires' }],
                nexusRequirements: {
                  nodes: [
                    {
                      modName: 'Knotwork',
                      notes: 'assets',
                      url: '',
                      modId: '128235',
                      gameId: '1704',
                      externalRequirement: false,
                    },
                    {
                      modName: 'Other Game Mod',
                      notes: '',
                      url: '',
                      modId: '55',
                      gameId: '999',
                      externalRequirement: false,
                    },
                    {
                      modName: 'SKSE',
                      notes: '',
                      url: 'https://skse.silverlock.org',
                      modId: '0',
                      gameId: '1704',
                      externalRequirement: true,
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    expect(details?.requirements).toEqual([
      { name: 'Dawnguard', dlc: true, notes: 'vampires' },
      { name: 'Knotwork', notes: 'assets', game: 'skyrimspecialedition', modId: 128235 },
      { name: 'Other Game Mod' },
      { name: 'SKSE', url: 'https://skse.silverlock.org' },
    ]);
  });

  it('omits absent optional fields', () => {
    const details = site.parseModDetails({
      data: {
        mods: { nodes: [{ modId: 1, name: 'Bare', game: { domainName: 'skyrim' } }] },
      },
    });
    expect(details).toEqual({ game: 'skyrim', modId: 1, name: 'Bare' });
  });

  it('is null when the mod does not exist', () => {
    expect(site.parseModDetails({ data: { mods: { nodes: [] } } })).toBeNull();
  });

  it('throws ScrapeError on an unexpected shape', () => {
    expect(() => site.parseModDetails({ data: {} })).toThrow(ScrapeError);
  });
});

describe('parseModDetailsPage', () => {
  const PAGE = `
    <meta property="og:title" content="TrueHUD Curated Bosses">
    <meta property="og:description" content="Stricter boss bar selection.">
    <meta property="og:image" content="https://staticdelivery.nexusmods.com/thumb.png">
    <ul class="stats clearfix">
      <li class="stat-endorsements">
        <div class="statitem">
          <div class="titlestat">Endorsements</div>
          <div class="stat"><a>4,501</a></div>
        </div>
      </li>
      <li class="stat-version">
        <div class="statitem">
          <div class="titlestat">Version</div>
          <div class="stat">1.2</div>
        </div>
      </li>
    </ul>
    <div class="sideitem timestamp">
      <h3>Last updated</h3>
      <time class="dst-date-adjust" data-date="1668354774">13 November 2022</time>
    </div>
    <div class="sideitem timestamp">
      <h3>Original upload</h3>
      <time class="dst-date-adjust" data-date="1628314498">07 August 2021</time>
    </div>
    <div class="sideitem">
      <h3>Created by</h3>
      Catir
    </div>
    <div class="sideitem">
      <h3>Uploaded by</h3>
      <a href="https://www.nexusmods.com/skyrimspecialedition/users/1">Catir</a>
    </div>
    <mod-download-modal requirements="[{&quot;type&quot;:&quot;dlc&quot;,&quot;name&quot;:&quot;Creation Club Content&quot;},{&quot;type&quot;:&quot;mod&quot;,&quot;name&quot;:&quot;TrueHUD - HUD Additions&quot;,&quot;url&quot;:&quot;https:\\/\\/www.nexusmods.com\\/skyrimspecialedition\\/mods\\/62775&quot;}]"></mod-download-modal>
  `;

  it('scrapes name, summary, version, dates, credits, and requirements', () => {
    const details = site.parseModDetailsPage(PAGE, 'skyrimspecialedition', 53406);
    expect(details).toMatchObject({
      game: 'skyrimspecialedition',
      modId: 53406,
      name: 'TrueHUD Curated Bosses',
      summary: 'Stricter boss bar selection.',
      version: '1.2',
      author: 'Catir',
      uploader: 'Catir',
      endorsements: 4501,
      createdAt: new Date(1628314498 * 1000).toISOString(),
      updatedAt: new Date(1668354774 * 1000).toISOString(),
      pictureUrl: 'https://staticdelivery.nexusmods.com/thumb.png',
    });
    expect(details?.requirements).toEqual([
      { name: 'Creation Club Content', dlc: true },
      {
        name: 'TrueHUD - HUD Additions',
        game: 'skyrimspecialedition',
        modId: 62775,
        url: 'https://www.nexusmods.com/skyrimspecialedition/mods/62775',
      },
    ]);
  });

  it('is null when the page has no og:title (not a mod page)', () => {
    expect(site.parseModDetailsPage('<html></html>', 'skyrimspecialedition', 1)).toBeNull();
  });

  it('omits requirements when the download-modal tag is absent', () => {
    const details = site.parseModDetailsPage(
      '<meta property="og:title" content="Bare Mod">',
      'skyrim',
      1,
    );
    expect(details).toEqual({ game: 'skyrim', modId: 1, name: 'Bare Mod' });
  });
});

describe('parseDownloadTargets', () => {
  const html = fixture('mod-files.html');

  it('categorises files by section', () => {
    const targets = site.parseDownloadTargets(html);
    const byCat = (c: string) => targets.filter((t) => t.category === c).map((t) => t.fileId);

    expect(byCat('main').sort((a, b) => a - b)).toEqual([4001, 4002]);
    expect(byCat('optional')).toEqual([4100]);
    expect(byCat('old')).toEqual([3900]);
  });

  it('builds the manual-download url from the file id', () => {
    const targets = site.parseDownloadTargets(html);
    const main = targets.find((t) => t.fileId === 4001);
    expect(main?.url).toBe(
      'https://www.nexusmods.com/skyrimspecialedition/mods/100?tab=files&file_id=4001',
    );
  });

  it('captures file names', () => {
    const targets = site.parseDownloadTargets(html);
    expect(targets.find((t) => t.fileId === 4001)?.fileName).toBe('Awesome Mod 2.1');
  });
});

describe('isAuthRedirect', () => {
  it('is true when bounced to the sign-in host', () => {
    expect(site.isAuthRedirect('https://users.nexusmods.com/auth/sign_in')).toBe(true);
  });

  it('is false for a normal mod files URL on the main host', () => {
    expect(
      site.isAuthRedirect('https://www.nexusmods.com/skyrimspecialedition/mods/100?tab=files'),
    ).toBe(false);
  });

  it('is false for a malformed URL', () => {
    expect(site.isAuthRedirect('not a url')).toBe(false);
  });
});
