import { describe, expect, it } from 'vitest';

import { parseNexusUrl } from '@adapters/nexus/parseNexusUrl.js';

describe('parseNexusUrl', () => {
  it('parses a mod url', () => {
    expect(parseNexusUrl('https://www.nexusmods.com/skyrimspecialedition/mods/12604')).toEqual({
      game: 'skyrimspecialedition',
      modId: 12604,
    });
  });

  it('parses a mod url with a tab/query suffix', () => {
    expect(
      parseNexusUrl('https://www.nexusmods.com/skyrimspecialedition/mods/12604?tab=files'),
    ).toEqual({ game: 'skyrimspecialedition', modId: 12604 });
  });

  it('parses the newer /games/ mod url shape', () => {
    expect(parseNexusUrl('https://www.nexusmods.com/games/starfield/mods/4')).toEqual({
      game: 'starfield',
      modId: 4,
    });
  });

  it('parses a collection url', () => {
    expect(
      parseNexusUrl('https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123/mods'),
    ).toEqual({ game: 'skyrimspecialedition', collection: 'abc123' });
  });

  it('prefers collection over mod when both could match', () => {
    const ref = parseNexusUrl(
      'https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123',
    );
    expect(ref).toEqual({ game: 'skyrimspecialedition', collection: 'abc123' });
  });

  it('returns null for an unrelated url', () => {
    expect(parseNexusUrl('https://example.com/foo/mods/1')).toBeNull();
    expect(parseNexusUrl('skyrimspecialedition')).toBeNull();
  });
});
