import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ScrapeError } from '@core/errors.js';
import { NexusWebAdapter } from '@adapters/nexus/NexusWebAdapter.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

const site = new NexusWebAdapter();

describe('NexusWebAdapter URLs', () => {
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

describe('resolveDownloadLinks', () => {
  const html = fixture('mod-files.html');

  it('categorises files by section', () => {
    const targets = site.resolveDownloadLinks(html);
    const byCat = (c: string) => targets.filter((t) => t.category === c).map((t) => t.fileId);

    expect(byCat('main').sort((a, b) => a - b)).toEqual([4001, 4002]);
    expect(byCat('optional')).toEqual([4100]);
    expect(byCat('old')).toEqual([3900]);
  });

  it('builds the manual-download url from the file id', () => {
    const targets = site.resolveDownloadLinks(html);
    const main = targets.find((t) => t.fileId === 4001);
    expect(main?.url).toBe(
      'https://www.nexusmods.com/skyrimspecialedition/mods/100?tab=files&file_id=4001',
    );
  });

  it('captures file names', () => {
    const targets = site.resolveDownloadLinks(html);
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
