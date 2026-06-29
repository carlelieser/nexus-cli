import type { Session } from '../../core/types.js';

/** Persistence boundary for the authenticated session. */
export interface SessionStore {
  save(s: Session): Promise<void>;
  load(): Promise<Session | null>;
  clear(): Promise<void>;
}
