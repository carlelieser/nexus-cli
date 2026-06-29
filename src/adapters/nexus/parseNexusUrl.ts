import type { GameDomain } from '@core/types.js';

/** A download target parsed from a Nexus URL: either a mod or a collection. */
export type NexusRef =
  { game: GameDomain; modId: number } | { game: GameDomain; collection: string };

// Mod page:        nexusmods.com/<game>/mods/<id>
// Newer mod page:  nexusmods.com/games/<game>/mods/<id>
const MOD = /nexusmods\.com\/(?:games\/)?([^/]+)\/mods\/(\d+)/i;
// Collection page: nexusmods.com/games/<game>/collections/<slug>
const COLLECTION = /nexusmods\.com\/games\/([^/]+)\/collections\/([^/?#]+)/i;

/**
 * Parse a nexusmods.com mod or collection URL into the game domain and id/slug
 * the `download` command needs. Returns null for anything that isn't a
 * recognised mod or collection URL (the caller falls back to explicit flags).
 */
export function parseNexusUrl(input: string): NexusRef | null {
  const collection = COLLECTION.exec(input);
  if (collection) {
    return { game: collection[1]!, collection: collection[2]! };
  }
  const mod = MOD.exec(input);
  if (mod) {
    return { game: mod[1]!, modId: Number(mod[2]) };
  }
  return null;
}
