import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { sessionFile } from '@config/paths.js';
import type { Session } from '@core/types.js';
import type { SessionStore } from './SessionStore.js';

/** Stores the session as a `600`-mode JSON file in the OS config dir. */
export class FileSessionStore implements SessionStore {
  constructor(private readonly path: string = sessionFile()) {}

  async save(s: Session): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(s, null, 2), { mode: 0o600 });
  }

  async load(): Promise<Session | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.username || !parsed.cookies) return null;
    return parsed;
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
