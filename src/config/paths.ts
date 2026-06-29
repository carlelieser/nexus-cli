import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { GameDomain } from '../core/types.js';

const APP = 'nexus-cli';

/**
 * OS-appropriate config directory.
 * - Linux: $XDG_CONFIG_HOME/nexus-cli or ~/.config/nexus-cli
 * - macOS: ~/Library/Application Support/nexus-cli
 * - Windows: %APPDATA%/nexus-cli
 */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, APP);

  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP);
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', APP);
    default:
      return join(homedir(), '.config', APP);
  }
}

/** Path to the persisted session file. */
export function sessionFile(): string {
  return join(configDir(), 'session.json');
}

/** Default download directory for a game domain. */
export function defaultOutDir(game: GameDomain): string {
  return join(process.cwd(), 'downloads', game);
}
